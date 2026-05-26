# my-pan — 轻量级个人网盘

基于 **S3 兼容对象存储** + **服务端签名** 的轻量级个人网盘。浏览器通过预签名 URL 直连存储上传/下载，服务端不传输文件数据。**支持多存储后端管理**。

> 兼容任意 S3 存储（AWS S3、Oracle Cloud、MinIO、CloudFlare R2 等）。支持 CloudFlare Workers（免费零成本）、Docker 和自建服务器三种部署方式。

## ✨ 特性

- **多存储管理** — 同时管理多个 S3 兼容存储后端，前端一键切换
- **暴力破解防护** — IP 级别速率限制，失败递增延迟 + 封锁机制（CloudFlare KV / 文件持久化）
- **文件预览** — 图片、PDF、视频、音频、文本等在弹窗中预览
- **文件分享** — 为文件/文件夹生成带密码保护的分享链接，支持过期时间和二维码
- **文件夹管理** — 新建、进入、下载、删除文件夹，面包屑导航，多选批量操作

## 🎨 架构

```
浏览器 ─── 服务端（API + 静态前端）
  │
  ├─ GET /api/storages ────────→ 返回存储列表（含容量配置）
  ├─ GET /api/files?storage=xx ─→ S3 文件列表
  ├─ POST /api/upload-url ─────→ 签发预签名上传 URL
  ├─ GET /api/files/:key ──────→ 签发预签名下载 URL
  ├─ GET /api/preview/:key ────→ 签发预签名预览 URL
  ├─ DELETE /api/files/:key ───→ 删除文件
  ├─ POST /api/shares ─────────→ 创建分享（需数据库）
  ├─ GET /s/:id ───────────────→ 分享访问页（公开）
  │
  ├─ PUT presigned URL ────────→  S3 直传（不经过服务端）
  └─ GET presigned URL ────────→  S3 直下（不经过服务端）
```

服务端负责签发 AWS SigV4 签名和托管前端，文件数据全程不经过服务端。

## 📖 前置条件

- **对象存储**：任意 S3 兼容存储（AWS S3 / Oracle Cloud / MinIO / CloudFlare R2 等），需配置 CORS 允许跨域上传
- **服务端运行时**（三选一）：
  - CloudFlare Workers — 免费额度内零成本，需 CloudFlare 账号
  - Docker — 无需 Node.js，一键部署，需 Docker 环境
  - 自建服务器 — 需 Node.js 18+，无需 CloudFlare 账号

## 🎯 部署方式一：CloudFlare Workers + GitHub Actions（推荐）

通过 GitHub Actions 自动部署到 CloudFlare Workers，push 代码即上线，无需本地安装任何工具。

### 1. Fork 仓库

在 GitHub 上 Fork 本仓库。

### 2. 获取 CloudFlare API 凭证

- **CLOUDFLARE_API_TOKEN**：进入 [CloudFlare Dashboard](https://dash.cloudflare.com) → 我的个人资料（右上角图标）→ API 令牌 → 创建令牌 → 选择「Edit Cloudflare Workers」模板
- **CLOUDFLARE_ACCOUNT_ID**：CloudFlare Dashboard 首页右侧，复制「账户 ID」

### 3. 准备存储配置

将你的对象存储信息组织为 JSON 数组。每个存储包含以下字段：


| 字段                | 必填  | 说明                                                            |
| ----------------- | --- | ------------------------------------------------------------- |
| `id`              | 是   | 唯一标识，对应 URL 参数 `?storage=<id>`                                |
| `name`            | 是   | 前端显示名称                                                        |
| `bucket`          | 是   | 存储桶名称                                                         |
| `region`          | 是   | S3 区域，如 `ca-toronto-1`、`auto`                                 |
| `endpoint`        | 是   | S3 端点 URL，如 `https://xxx.oraclecloud.com`                     |
| `accessKeyId`     | 是   | S3 Access Key                                                 |
| `secretAccessKey` | 是   | S3 Secret Key                                                 |
| `capacity`        | 否   | 总容量，如 `"20GB"` 或 `"500MB"`，支持 B/KB/MB/GB/TB（1024 进制），不填则隐藏进度条 |


示例：

```json
[
    {
        "id": "oracle",
        "name": "Oracle Cloud",
        "capacity": "20GB",
        "bucket": "bucket-xxx",
        "region": "ca-toronto-1",
        "endpoint": "https://xxx.oraclecloud.com",
        "accessKeyId": "your-access-key",
        "secretAccessKey": "your-secret-key"
    },
    {
        "id": "r2",
        "name": "Cloudflare R2",
        "capacity": "500MB",
        "bucket": "bucket-xxx",
        "region": "auto",
        "endpoint": "https://xxx.r2.cloudflarestorage.com",
        "accessKeyId": "your-access-key",
        "secretAccessKey": "your-secret-key"
    }
]
```

### 4. 设置 GitHub Secrets

在 Fork 后的仓库中，进入 **Settings → Secrets and variables → Actions**，添加以下 secrets：


| Secret                  | 说明                         | 必填  |
| ----------------------- | -------------------------- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | CloudFlare 账户 ID           | 是   |
| `CLOUDFLARE_API_TOKEN`  | CloudFlare API 令牌          | 是   |
| `S3_LIST_JSON`          | 完整存储配置 JSON（含密钥）           | 是   |
| `AUTH_PASSWORD`         | 前端访问密码                     | 否   |
| `D1_DATABASE_NAME`      | D1 数据库名称，设置后启用分享功能         | 否   |
| `KV_BINDING_ID`         | KV 命名空间 ID，设置后启用 IP 速率限制   | 否   |


### 5. 启用速率限制（可选）

> 速率限制为 IP 级别的暴力破解防护：同一 IP 失败 ≥5 次开始递增延迟（2ⁿ⁻⁵ 秒，上限 30s），≥10 次封锁 15 分钟。密码正确后立即清除计数。

<details>
<summary>点击展开 KV 配置步骤</summary>

1. 在 CloudFlare Dashboard → Workers 和 Pages → KV → 创建命名空间，名称随意（如 `my-pan-rate-limit`）
2. 创建后复制命名空间 ID（类似 `47f15a4c7fdc4ce9958fc0f46a4c77f5`）
3. 在 GitHub Secrets 中添加 `KV_BINDING_ID` = 该 ID
4. CI 部署时自动注入 KV 绑定，无需手动修改 `wrangler.toml`

未配置 `KV_BINDING_ID` 时速率限制静默跳过，不影响正常使用。

</details>

### 6. 触发部署

- **自动部署**：push 到 master 分支自动触发
- **手动部署**：Actions 页面 → Deploy Worker → Run workflow

部署成功后，Worker 地址为 `https://my-pan.<your-subdomain>.workers.dev`。

### 6. 配置自定义域名（可选）

在 CloudFlare Dashboard → Workers 和 Pages → 你的 Worker → 触发器 → 自定义域中添加域名。

---

## 📱 部署方式二：本地 Wrangler CLI 部署

适合需要在本地调试、修改代码后再部署的场景。

### 1. 克隆并安装

```bash
git clone https://github.com/<your-username>/my-pan.git
cd my-pan/worker
npm install
```

### 2. 配置存储

创建 `worker/.dev.vars` 文件：

```env
S3_LIST_JSON = '[{"id":"oracle","name":"Oracle Cloud","capacity":"20GB","bucket":"bucket-xxx","region":"ca-toronto-1","endpoint":"https://xxx.oraclecloud.com","accessKeyId":"your-access-key","secretAccessKey":"your-secret-key"}]'
AUTH_PASSWORD = your-password
```

如需速率限制，在 `worker/wrangler.toml` 中将 `[[kv_namespaces]]` 的 `id` 替换为真实 KV 命名空间 ID。不配置则速率限制静默跳过。

### 3. 本地调试

创建本地数据库：

```bash
npx wrangler d1 execute my-pan --local --file=./db/schema.sql
```

启动服务

```bash
npm run dev
```

启动后访问 `http://localhost:8787`。此模式同时提供 API 和静态前端，修改代码后自动热更新。

### 4. 部署到 CloudFlare

首次部署前需要登录 Wrangler：

```bash
npx wrangler login
```

然后将密钥上传到 CloudFlare，避免明文存储在配置文件中：

```bash
npx wrangler secret put S3_LIST_JSON          # 粘贴完整 JSON 数组
npx wrangler secret put AUTH_PASSWORD         # 可选
```

最后部署：

```bash
npm run deploy
```

---

## 🖥️ 部署方式三：自建服务器（Express + SQLite）

无需 CloudFlare 账号，在自己的 VPS 或服务器上运行。核心逻辑与 Worker 版共享，无需 Wrangler CLI。

### 1. 克隆并安装

```bash
git clone https://github.com/<your-username>/my-pan.git
cd my-pan/server
npm install
```

### 2. 配置环境变量

创建 `server/.env` 文件：

```env
S3_LIST_JSON = '[{"id":"oracle","name":"Oracle Cloud","capacity":"20GB","bucket":"bucket-xxx","region":"ca-toronto-1","endpoint":"https://xxx.oraclecloud.com","accessKeyId":"your-access-key","secretAccessKey":"your-secret-key"}]'
AUTH_PASSWORD = your-password
PORT = 8787
# DATABASE_PATH = ./data/my-pan.db
# RATE_LIMIT_PATH = ./data/rate-limits.json
```


| 变量               | 说明                    | 必填  |
| ---------------- | --------------------- | --- |
| `S3_LIST_JSON`   | 完整存储配置 JSON（含密钥）      | 是   |
| `AUTH_PASSWORD`  | 前端访问密码                | 否   |
| `PORT`           | 监听端口，默认 8787          | 否   |
| `DATABASE_PATH`  | SQLite 数据库路径，默认 `./data/my-pan.db` | 否   |
| `RATE_LIMIT_PATH` | 速率限制持久化文件路径，默认 `./data/rate-limits.json` | 否   |


分享功能基于 SQLite（`sql.js`，纯 JS 实现，零原生编译依赖），数据库文件自动创建于 `server/data/my-pan.db`，无需额外配置。速率限制状态持久化在 `server/data/rate-limits.json`，容器/进程重启不丢失。

### 3. 启动

```bash
cd my-pan/server
npm start
```

访问 `http://localhost:8787`。

### 4. 生产部署

**Nginx 反代**（推荐前置 Nginx 处理 HTTPS）：

```nginx
# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name pan.example.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS 反代
server {
    listen 443 ssl;
    http2 on;
    server_name pan.example.com;

    ssl_certificate     /etc/nginx/ssl/pan.example.com.pem;
    ssl_certificate_key /etc/nginx/ssl/pan.example.com.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
        proxy_read_timeout 600s;  # 大文件上传
        client_max_body_size 10G; # 根据需求调整
    }
}
```

**Systemd 服务**（`/etc/systemd/system/my-pan.service`）：

```ini
[Unit]
Description=my-pan
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/my-pan/server
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now my-pan
```

---

## 🐳 部署方式四：Docker / Docker Compose

无需安装 Node.js，通过容器一键部署。预构建镜像已推送至 Docker Hub。

### 1. 准备 docker-compose.yml

```yaml
services:
  my-pan:
    image: wsx9172/my-pan:latest
    container_name: my-pan
    ports:
      - "8787:8787"
    environment:
      S3_LIST_JSON: |
        [
          {
            "id": "default",
            "name": "My Storage",
            "bucket": "your-bucket",
            "region": "your-region",
            "endpoint": "https://your-endpoint",
            "accessKeyId": "your-access-key",
            "secretAccessKey": "your-secret-key"
          }
        ]
      # 访问密码
      AUTH_PASSWORD: "your-password"
      # 可选：端口（默认 8787，若修改需同步 ports）
      # PORT: "8787"
      # 可选：速率限制持久化路径（默认 /app/data/rate-limits.json）
      # RATE_LIMIT_PATH: /app/data/rate-limits.json
    volumes:
      # 持久化 SQLite 数据库 + 速率限制状态
      - ./data:/app/data
    restart: unless-stopped
```

### 2. 配置多存储与密码

在 `S3_LIST_JSON` 数组中添加多个对象存储配置，前端会自动显示存储源选择器。
修改默认密码 `AUTH_PASSWORD` 。

### 3. 启动

```bash
docker compose up -d
```

访问 `http://localhost:8787`。分享功能自动启用，数据持久化在 `./data` 目录。

### 4. 升级

```bash
docker compose pull
docker compose up -d
```

### 5. 环境变量参考


| 变量               | 必填  | 默认值                          | 说明                |
| ---------------- | --- | ---------------------------- | ----------------- |
| `S3_LIST_JSON`   | 是   | —                            | 存储配置 JSON 数组（含密钥） |
| `AUTH_PASSWORD`  | 否   | 无                            | 不设置则跳过鉴权          |
| `PORT`           | 否   | `8787`                       | 容器内监听端口           |
| `DATABASE_PATH`  | 否   | `/app/data/my-pan.db`        | SQLite 数据库路径      |
| `RATE_LIMIT_PATH` | 否   | `/app/data/rate-limits.json` | 速率限制持久化文件路径     |


---

## 🔄 分享功能

### CloudFlare Workers（D1 数据库）

在 Worker 部署中，分享功能基于 CloudFlare D1（SQLite 兼容）：

1. 创建 D1 数据库（名称如 `my-pan-db`）
2. 在 GitHub Secrets 中设置 `D1_DATABASE_NAME` = `my-pan-db`
3. 或本地部署时设置 `npx wrangler secret put D1_DATABASE_NAME`
4. CI 或 Wrangler 会自动执行 `db/schema.sql` 建表

分享记录包含 `storage_id` 列，公开访问页据此路由到正确的存储后端签发签名 URL。

### 自建服务器（SQLite）

服务器部署中分享功能**无需额外配置**，启动时自动创建 SQLite 数据库文件（`server/data/my-pan.db`）。表结构与 D1 完全一致。

### 使用

在主界面按认证密码登录后，文件行和右键菜单中会出现「分享」按钮。可设置分享密码（6 位字母/数字）、过期时间（1 小时 ~ 永不过期），并生成分享二维码。

## 🛡️ 速率限制

对所有鉴权端点（主密码、分享密码）进行 IP 级别速率限制，防止暴力破解：

| 失败次数 | 行为 |
| ------- | --- |
| < 5 次  | 正常响应 |
| 5 ~ 9 次 | 递增延迟：2ⁿ⁻⁵ 秒（2s → 4s → 8s → 16s），上限 30s |
| ≥ 10 次 | 封锁 15 分钟，返回 429 + `Retry-After` 头 |

密码正确后立即重置该 IP 的所有计数。1 小时内无失败记录自动清理。

**各部署方式的持久化**：

| 部署方式 | 存储后端 | 重启影响 |
| ------- | ------ | --- |
| CloudFlare Workers | KV（需配置 `KV_BINDING_ID`） | 无影响 |
| Docker | 文件（`/app/data/rate-limits.json`，挂载卷） | 无影响 |
| 自建服务器 | 文件（`./data/rate-limits.json`） | 无影响 |

未配置存储后端时速率限制静默跳过，不影响正常使用。

## 📖 API 端点

所有文件操作端点支持 `?storage=<id>` 参数指定目标存储后端。


| 端点                              | 方法       | 鉴权  | 说明                                                           |
| ------------------------------- | -------- | --- | ------------------------------------------------------------ |
| `/api/storages`                 | GET      | 需要  | 返回可用存储列表（id/name/capacity/capacityUnit，不含密钥）                 |
| `/api/files?storage=xx`         | GET      | 需要  | 列出存储桶中所有文件（S3 XML → JSON）                                    |
| `/api/files/:key?storage=xx`    | GET      | 需要  | 获取文件的预签名下载 URL                                               |
| `/api/preview/:key?storage=xx`  | GET      | 需要  | 获取文件的预签名预览 URL，`?charset=gbk` 指定编码                           |
| `/api/upload-url?storage=xx`    | POST     | 需要  | 生成预签名上传 URL，Body: `{key, contentType}`                       |
| `/api/files/:key?storage=xx`    | DELETE   | 需要  | 删除文件                                                         |
| `/api/batch-delete?storage=xx`  | POST     | 需要  | 批量删除文件，Body: `{keys: [...]}`                                 |
| `/api/rename?storage=xx`        | PUT      | 需要  | 重命名/移动文件，Body: `{sourceKey, destinationKey}`                 |
| `/api/shares?storage=xx`        | POST     | 需要  | 创建分享，Body: `{fileKey, fileName, password?, expiresInHours?}` |
| `/api/shares`                   | GET      | 需要  | 列出所有分享（支持分页 `?page=&pageSize=`）                              |
| `/api/shares/status`            | GET      | 需要  | 检查分享功能可用性                                                    |
| `/api/shares/batch-delete`      | POST     | 需要  | 批量删除分享                                                       |
| `/api/shares/:id`               | DELETE   | 需要  | 删除分享                                                         |
| `/api/files/:key?share_id=xx`   | GET      | 公开  | 分享文件下载（需 share_id + 可选 share_pw）                             |
| `/api/preview/:key?share_id=xx` | GET      | 公开  | 分享文件预览（需 share_id + 可选 share_pw）                             |
| `/s/:id`                        | GET/POST | 公开  | 分享访问页                                                        |


所有鉴权端点通过 `X-Auth-Password` 头传递密码。无密码时不校验。

## 🚀 技术栈

- **签名算法**：AWS Signature V4（HMAC-SHA256 via Web Crypto API）
- **运行环境**：CloudFlare Workers / Node.js + Express，共享同一套核心逻辑
- **前端**：单页 HTML + Vanilla JS + CSS，零框架
- **存储后端**：任意 S3 兼容对象存储，支持多后端管理
- **数据库**：CloudFlare D1 / SQLite（sql.js），仅分享功能需要
- **部署**：GitHub Actions 自动部署 / Wrangler CLI / Docker / systemd + nginx

## 📖 许可证

MIT