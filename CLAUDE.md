# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

轻量级个人网盘：任意 S3 兼容对象存储（Oracle Cloud / AWS S3 / MinIO / CloudFlare R2 等）作为后端，CloudFlare Worker 签发预签名 URL 并托管静态前端。浏览器直连 S3 上传/下载，Worker 永不接触文件数据。可选分享功能（D1 数据库 + 密码保护 + 过期时间 + 二维码）。**支持多存储后端**，通过 `?storage=<id>` 参数切换，前端有存储源选择器。

## Architecture

```
Browser ─── Worker (API + Static Assets)
  │
  ├─ GET /api/storages ────────→ 返回可用存储列表（仅 id/name，无密钥）
  ├─ GET /api/files?storage=xx ─→ S3 (list XML → JSON)
  ├─ POST /api/upload-url ─────→ 返回 presigned PUT URL
  ├─ GET /api/files/:key ──────→ 返回 presigned GET URL (下载)
  ├─ GET /api/preview/:key ────→ 返回 presigned GET URL (预览, 支持 ?charset=)
  ├─ DELETE /api/files/:key ───→ S3 (proxy)
  ├─ POST /api/shares ─────────→ D1 (创建分享, 存储 storage_id)
  ├─ GET /api/shares ──────────→ D1 (列出分享)
  ├─ DELETE /api/shares/:id ───→ D1 (删除分享)
  ├─ GET /s/:id ───────────────→ 分享访问页（公开, 根据 storage_id 路由到正确后端）
  │
  ├─ GET / ────────────────────→ 静态前端 (index.html)
  │
  └─ PUT presigned URL ────────→ S3 (direct upload)
  └─ GET presigned URL ────────→ S3 (direct download)
```

- **Worker** (`worker/src/index.ts`) — 路由分发 + 文件操作 handler。定义 `StorageConfig` / `StorageInfo` / `Env` 接口，`getStorages(env)` 三级解析存储配置，`getStorage(env, id?)` 按 ID 查找。API 端点：list / download-url / preview-url / upload-url / delete / rename / batch-delete 均接受 `StorageConfig` 参数而非 `Env`。鉴权通过 `X-Auth-Password` 头。新增 `GET /api/storages` 返回不含密钥的存储列表。速率限制 (`worker/src/rate-limit.ts`) — 基于 IP 的防暴力破解，递增延迟 + 15 分钟封锁。
- **SigV4 签名** (`worker/src/s3-auth.ts`) — `signRequest()` 用于 Worker→S3 代理请求（Authorization header）；`generatePresignedUrl()` 用于签发浏览器直连 S3 的 URL（query-string auth），支持 `response-content-disposition`、`response-content-type` 覆写。均使用 HMAC-SHA256 via Web Crypto API。`rfc3986()` 编码比 `encodeURIComponent` 更严格（多编码 `!'()*`）。
- **分享功能** (`worker/src/shares.ts`) — 基于 CloudFlare D1 数据库，密码明文存储，支持过期时间、访问计数、`storage_id` 列（记录分享属于哪个存储后端）。通过 `/s/:id` 提供公开访问页，内建预览弹窗（iframe + 编码选择）。可插拔设计：D1 未配置时分享功能自动隐藏。`listShareFolderFiles()` 接受 `StorageConfig` 而非 `Env`。
- **静态前端** (`pages/public/`) — 五文件结构：`index.html`（纯 HTML 结构）、`style.css`（样式）、`app.js`（交互逻辑）、`qrcode.js`（QR 码生成库）、`column-resizer.js`（列宽拖拽）。单页应用：密码登录、存储源选择器（仅多存储时显示）、全局拖拽/点击上传（XHR 直连 S3 支持进度条）、预签名 URL 下载/预览（iframe 弹窗 + 字符集选择）、文件列表排序（文件夹和文件分别排序、列宽可拖拽调整）、面包屑导航、多选批量操作（下载/删除）、右键菜单（分享/预览/下载/重命名/删除）、分享管理（创建/列表/删除分享 + QR 码生成）、搜索高亮。`fileApi(path)` 辅助函数统一在文件操作 URL 中追加 `?storage=` 参数。存储选择持久化到 localStorage (`my-pan_storage`)。由 Worker 的 Static Assets 功能托管，与 API 同域，无需 CORS 或跨域配置。

## Multi-storage config resolution

**三级优先级**（`getStorages()` 在 [worker/src/index.ts](worker/src/index.ts) 中实现）：

```
1. STORAGES_CONFIG (secret) — 本地 .dev.vars，完整 JSON 含密钥
   → 直接解析为 StorageConfig[]
2. STORAGES (plain var, 不含密钥) + 命名规范 secrets
   → STORAGE_<UPPERCASED_ID>_KEY_ID / STORAGE_<UPPERCASED_ID>_SECRET
   → 运行时拼入 StorageConfig
3. S3_BUCKET / S3_REGION / S3_ENDPOINT + S3_ACCESS_KEY_ID / S3_SECRET_KEY
   → 构造单条 default 存储
```

**数据结构**：

```typescript
interface StorageInfo {
  id: string;       // 唯一标识，对应 ?storage= 参数和 secret 命名
  name: string;     // 前端显示名称
  bucket: string;
  region: string;
  endpoint: string;
}

interface StorageConfig extends StorageInfo {
  accessKeyId: string;  // 运行时从 secrets 拼入
  secretKey: string;
}
```

**密钥命名规范**：`STORAGE_${id.toUpperCase()}_KEY_ID` / `STORAGE_${id.toUpperCase()}_SECRET`。例如 id 为 `oracle` → `STORAGE_ORACLE_KEY_ID` / `STORAGE_ORACLE_SECRET`。

## Key design decisions

- **配置与密钥解耦** — 非敏感配置（bucket/region/endpoint）放 `STORAGES` plain var，密钥放 `STORAGE_<ID>_KEY_ID` / `STORAGE_<ID>_SECRET` secrets。本地开发可用 `STORAGES_CONFIG` secret 直接嵌入完整 JSON（含密钥）。
- **目录即是零字节对象** — S3 中目录以 `/` 结尾的零字节对象表示。上传文件时自动创建祖先目录标记（`ensureDirMarker`），删除文件时保留父级目录（`preserveAncestorDirs`），避免 S3 的"假目录"在文件清空后消失。
- **文本预览 charset 覆写** — Worker 通过 `response-content-type` 查询参数强制文本文件为 `text/plain; charset=utf-8`，解决 TXT 编码乱码和 `.md` 等浏览器不识别的 MIME 类型触发下载问题。前端预览弹窗支持切换编码（GBK/Big5 等）。
- **XML 实体解码** — S3 ListObjects 返回的 XML 中 `&` 等字符会被转义为 `&amp;`，`parseListXml` 用 `decodeXml()` 还原。
- **拖拽遮罩** — 全局 `dragenter`/`dragleave` 计数器控制全屏遮罩显隐，`dragend` 兜底防止状态残留。uploadZone 的 drop handler 需同步重置计数器。
- **文件夹多选** — `selectedKeys` Set 追踪文件，`selectedFolders` Set 追踪目录前缀。级联勾选需遍历全局 `files` 数组（不仅 DOM），覆盖未渲染的子目录文件。
- **分享可插拔** — 分享功能完全由 D1 数据库驱动。CI 先删除本地 D1 配置，仅当 `D1_DATABASE_NAME` secret 存在时才追加真实配置。前端通过 `/api/shares/status` 检测可用性并自动显隐相关按钮。分享记录含 `storage_id` 列，公开访问页据此路由到正确的存储后端签发签名 URL。
- **列宽可拖拽** — 表头和数据行均有拖拽手柄，`table-layout: fixed` 保证列宽独立。拖拽时全局禁止选中，避免蓝色高亮。

## Commands

```bash
cd worker && npm install        # 安装 Worker 依赖
cd worker && npm run dev        # 本地开发服务器（同时提供 API + 静态前端）
cd worker && npx tsc --noEmit   # 类型检查
cd worker && npm run deploy     # 一键部署 Worker + 静态资源
```

## Environment variables and secrets

### 生产推荐：配置与密钥解耦

**plain var**（`wrangler.toml` `[vars]`，非敏感，CF 控制台明文可见）：

```toml
[vars]
STORAGES = '[
  {"id":"oracle","name":"Oracle Cloud","bucket":"bucket-xxx","region":"ca-toronto-1","endpoint":"https://xxx.oraclecloud.com"},
  {"id":"r2","name":"Cloudflare R2","bucket":"my-bucket","region":"auto","endpoint":"https://xxx.r2.cloudflarestorage.com"}
]'
```

**secrets**（`wrangler secret put`，加密存储，不可回读）：

```bash
# 每个存储独立设置密钥（命名规范 STORAGE_<UPPERCASED_ID>_KEY_ID / _SECRET）
npx wrangler secret put STORAGE_ORACLE_KEY_ID
npx wrangler secret put STORAGE_ORACLE_SECRET
npx wrangler secret put STORAGE_R2_KEY_ID
npx wrangler secret put STORAGE_R2_SECRET

# 旧版单存储 fallback（始终保留）
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_KEY
npx wrangler secret put AUTH_PASSWORD   # 可选
```

### 本地开发

在 `worker/.dev.vars` 中用 `STORAGES_CONFIG` 直接写完整 JSON（含密钥），方便调试：

```env
STORAGES_CONFIG = '[{"id":"oracle","name":"Oracle","bucket":"...","region":"...","endpoint":"...","accessKeyId":"...","secretKey":"..."},{"id":"r2","name":"R2","bucket":"...","region":"auto","endpoint":"...","accessKeyId":"...","secretKey":"..."}]'
```

### GitHub Actions CI

- `STORAGES` 作为 GitHub Variable（非敏感）
- `STORAGE_ORACLE_KEY_ID`、`STORAGE_ORACLE_SECRET` 等作为 GitHub Secrets
- CI 通过 `wrangler secret put` 同步到 CloudFlare（[deploy.yml](.github/workflows/deploy.yml) 中有模板可复制）
- 旧版 `S3_*` secrets 保留向后兼容

## File structure

```
my-pan/
├── pages/public/
│   ├── index.html              # 静态前端 HTML 结构（含存储选择器）
│   ├── style.css               # 样式（含 .storage-select）
│   ├── app.js                  # 交互逻辑（fileApi() 辅助函数、loadStorages()）
│   ├── qrcode.js               # QR 码生成库 (qrcode-generator)
│   └── column-resizer.js       # 列宽拖拽库
├── worker/
│   ├── src/
│   │   ├── index.ts            # Worker 入口 + API 路由 + StorageConfig/Env 接口 + 三级配置解析
│   │   ├── s3-auth.ts          # AWS SigV4 签名 + 预签名 URL 生成
│   │   ├── shares.ts           # 分享功能（D1 + 公开访问页 + storage_id 支持）
│   │   ├── rate-limit.ts       # IP 级防暴力破解速率限制
│   │   └── utils.ts            # CORS headers / JSON 响应 / HTML 转义
│   ├── db/
│   │   └── schema.sql          # D1 建表 SQL（含 storage_id 列）
│   ├── package.json
│   ├── tsconfig.json
│   └── wrangler.toml
├── .github/workflows/
│   └── deploy.yml              # GitHub Actions 自动部署（CloudFlare Workers + Docker）
└── README.md
```
