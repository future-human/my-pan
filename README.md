# my-pan — 轻量级个人网盘

基于 **S3 兼容对象存储** + **服务端签名** 的轻量级个人网盘：浏览器通过预签名直连存储，服务端不接触文件数据。

> 兼容任意 S3 存储（AWS S3、Oracle Cloud、MinIO、CloudFlare R2 等）。支持 CloudFlare Workers（免费零成本）、Docker 和自建服务器三种部署方式。

## ✨ 特性

- **直连存储** — 浏览器通过预签名 URL 直传/直下 S3，文件数据不经过服务端
- **多存储管理** — 同时管理多个 S3 存储后端，前端一键切换
- **文件预览** — 图片、PDF、视频、音频、文本等在线预览，支持多编码切换
- **文件分享** — 密码保护 + 过期时间 + 二维码，可分享文件或文件夹

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
  ├─ PUT presigned URL ────────→ S3 直传（不经过服务端）
  └─ GET presigned URL ────────→ S3 直下（不经过服务端）
```

服务端负责签发 AWS SigV4 签名和托管前端，文件数据全程不经过服务端。

## 📦 存储配置

`S3_LIST_JSON` 为 JSON 数组，每项对应一个存储后端。所有部署方式共用此格式。


| 字段                | 必填  | 说明                                        |
| ----------------- | --- | ----------------------------------------- |
| `id`              | 是   | 唯一标识，对应 URL 参数 `?storage=<id>`            |
| `name`            | 是   | 前端显示名称                                    |
| `bucket`          | 是   | 存储桶名称                                     |
| `region`          | 是   | S3 区域，如 `ca-toronto-1`、`auto`             |
| `endpoint`        | 是   | S3 端点 URL，如 `https://xxx.oraclecloud.com` |
| `accessKeyId`     | 是   | S3 Access Key                             |
| `secretAccessKey` | 是   | S3 Secret Key                             |
| `capacity`        | 否   | 总容量，如 `"20GB"` 或 `"500MB"`，不填则隐藏进度条       |


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

## 🚀 部署方式

### CloudFlare Workers + GitHub Actions（推荐）

通过 GitHub Actions 自动部署到 CloudFlare Workers，push 代码即上线，免费额度内零成本。

**前置条件**：CloudFlare 账号、GitHub 账号。

#### 1. Fork 仓库并设置 Secrets

Fork 后在仓库 Settings → Secrets and variables → Actions 中添加：


| Secret                  | 说明                                            | 必填  |
| ----------------------- | --------------------------------------------- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | CloudFlare 账户 ID（Dashboard 首页右侧）              | 是   |
| `CLOUDFLARE_API_TOKEN`  | CloudFlare API 令牌（Edit Cloudflare Workers 模板） | 是   |
| `S3_LIST_JSON`          | 完整存储配置 JSON 数组（含密钥），格式见[存储配置](#-存储配置)         | 是   |
| `AUTH_PASSWORD`         | 前端访问密码                                        | 否   |
| `D1_DATABASE_NAME`      | D1 数据库名称，设置后启用分享功能                            | 否   |
| `KV_BINDING_ID`         | KV 命名空间 ID，设置后启用 IP 速率限制                      | 否   |


#### 2. 触发部署

Push 到 master 分支自动部署。也可在 Actions 页面手动 Run workflow。

部署成功后访问 `https://my-pan.<your-subdomain>.workers.dev`。

#### 3. 自定义域名（可选）

CloudFlare Dashboard → Workers 和 Pages → 你的 Worker → 触发器 → 自定义域。

#### 本地开发

```bash
cd worker
npm install
```

创建 `worker/.dev.vars`：

```env
S3_LIST_JSON = '[{"id":"oracle","name":"Oracle Cloud","bucket":"bucket-xxx","region":"ca-toronto-1","endpoint":"https://xxx.oraclecloud.com","accessKeyId":"your-access-key","secretAccessKey":"your-secret-key"}]'
AUTH_PASSWORD = your-password
```

```bash
npx wrangler d1 execute my-pan --local --file=./db/schema.sql  # 创建本地数据库
npm run dev                                                     # 启动 http://localhost:8787
```

---

### Docker / Docker Compose

无需安装 Node.js，容器化一键部署。预构建镜像已推送至 Docker Hub。

**前置条件**：Docker 环境。

#### docker-compose.yml

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
      AUTH_PASSWORD: "your-password"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

#### 环境变量


| 变量                | 必填  | 默认值                          | 说明                |
| ----------------- | --- | ---------------------------- | ----------------- |
| `S3_LIST_JSON`    | 是   | —                            | 存储配置 JSON 数组（含密钥） |
| `AUTH_PASSWORD`   | 否   | —                            | 不设置则跳过鉴权          |
| `PORT`            | 否   | `8787`                       | 容器内监听端口           |
| `DATABASE_PATH`   | 否   | `/app/data/my-pan.db`        | SQLite 数据库路径      |
| `RATE_LIMIT_PATH` | 否   | `/app/data/rate-limits.json` | 速率限制持久化路径         |


#### 操作

```bash
docker compose up -d       # 启动，访问 http://localhost:8787
docker compose pull        # 拉取新镜像
docker compose up -d       # 升级
```

分享功能与登陆状态相关数据持久化在 `./data` 目录。

---

### 自建服务器（Express + SQLite）

无需 CloudFlare 账号，在自己的 VPS 上运行。

**前置条件**：Node.js 18+。

#### 1. 安装配置

```bash
cd server
npm install
```

创建 `server/.env`：

```env
S3_LIST_JSON = '[{"id":"oracle","name":"Oracle Cloud","bucket":"bucket-xxx","region":"ca-toronto-1","endpoint":"https://xxx.oraclecloud.com","accessKeyId":"your-access-key","secretAccessKey":"your-secret-key"}]'
AUTH_PASSWORD = your-password
PORT = 8787
```


| 变量                | 必填  | 默认值                       | 说明                |
| ----------------- | --- | ------------------------- | ----------------- |
| `S3_LIST_JSON`    | 是   | —                         | 存储配置 JSON 数组（含密钥） |
| `AUTH_PASSWORD`   | 否   | —                         | 不设置则跳过鉴权          |
| `PORT`            | 否   | `8787`                    | 监听端口              |
| `DATABASE_PATH`   | 否   | `./data/my-pan.db`        | SQLite 数据库路径      |
| `RATE_LIMIT_PATH` | 否   | `./data/rate-limits.json` | 速率限制持久化路径         |


#### 2. 启动

```bash
npm start                  # 访问 http://localhost:8787
```

#### 3. 生产部署

**Nginx 反向代理**：

```nginx
server {
    listen 80;
    server_name pan.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
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
        proxy_read_timeout 600s;
        client_max_body_size 10G;
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

## 🔧 功能配置

### 分享功能


| 部署方式               | 存储后端           | 配置方式                                |
| ------------------ | -------------- | ----------------------------------- |
| CloudFlare Workers | D1（SQLite 兼容）  | 设置 GitHub Secret `D1_DATABASE_NAME` |
| Docker / 自建服务器     | SQLite（sql.js） | 无需配置，自动创建 `my-pan.db`               |


分享功能启用后，文件行和右键菜单中会出现「分享」按钮。支持：

- 设置分享密码
- 过期时间（1 小时 ~ 永不过期）
- 二维码生成
- 访问计数
- 分享历史管理

### 爆破防护


| 部署方式               | 存储后端                   | 配置方式                             |
| ------------------ | ---------------------- | -------------------------------- |
| CloudFlare Workers | KV                     | 设置 GitHub Secret `KV_BINDING_ID` |
| Docker / 自建服务器     | 文件（`rate-limits.json`） | 无需配置，自动持久化                       |


IP 级别暴力破解防护，覆盖所有鉴权端点：


| 失败次数    | 行为                                     |
| ------- | -------------------------------------- |
| < 5 次   | 正常响应                                   |
| 5 ~ 9 次 | 递增延迟：2ⁿ⁻⁵ 秒（2s → 4s → 8s → 16s），上限 30s |
| ≥ 10 次  | 封锁 15 分钟，返回 429 + `Retry-After` 头      |


密码正确后立即重置。1 小时无失败记录自动清理。

未配置时速率限制静默跳过，不影响正常使用。

## 📖 API 端点

所有文件操作端点支持 `?storage=<id>` 参数指定目标存储。


| 端点                              | 方法       | 鉴权  | 说明                                                     |
| ------------------------------- | -------- | --- | ------------------------------------------------------ |
| `/api/login`                    | POST     | 公开  | 密码换取 Token，`{password}` → `{token}`                    |
| `/api/logout`                   | POST     | 需要  | 吊销当前 Token                                             |
| `/api/storages`                 | GET      | 需要  | 返回存储列表（id/name/capacity，不含密钥）                          |
| `/api/files`                    | GET      | 需要  | 列出文件（S3 XML → JSON）                                    |
| `/api/files/:key`               | GET      | 需要  | 签发预签名下载 URL                                            |
| `/api/preview/:key`             | GET      | 需要  | 签发预签名预览 URL，`?charset=gbk` 指定编码                        |
| `/api/upload-url`               | POST     | 需要  | 签发预签名上传 URL，`{key, contentType}`                       |
| `/api/files/:key`               | DELETE   | 需要  | 删除文件                                                   |
| `/api/batch-delete`             | POST     | 需要  | 批量删除，`{keys: [...]}`                                   |
| `/api/rename`                   | PUT      | 需要  | 重命名/移动，`{sourceKey, destinationKey}`                   |
| `/api/shares`                   | POST     | 需要  | 创建分享，`{fileKey, fileName, password?, expiresInHours?}` |
| `/api/shares`                   | GET      | 需要  | 列出分享（`?page=&pageSize=`）                               |
| `/api/shares/status`            | GET      | 需要  | 检测分享功能可用性                                              |
| `/api/shares/:id`               | DELETE   | 需要  | 删除分享                                                   |
| `/api/shares/batch-delete`      | POST     | 需要  | 批量删除分享                                                 |
| `/api/files/:key?share_id=xx`   | GET      | 公开  | 分享文件下载                                                 |
| `/api/preview/:key?share_id=xx` | GET      | 公开  | 分享文件预览                                                 |
| `/s/:id`                        | GET/POST | 公开  | 分享访问页                                                  |


鉴权方式：`POST /api/login` 密码换取 Token（UUID），Cookie 存储，后续请求通过 `X-Auth-Token` 头传递。未配置 `AUTH_PASSWORD` 时跳过鉴权。

## 🛠 技术栈

- **签名算法**：AWS Signature V4（HMAC-SHA256 via Web Crypto API）
- **运行时**：CloudFlare Workers / Node.js + Express，共享核心逻辑
- **前端**：单页 HTML + Vanilla JS + CSS，零框架
- **存储后端**：任意 S3 兼容对象存储
- **数据库**：CloudFlare D1 / SQLite（sql.js），仅分享功能需要
- **部署**：GitHub Actions / Docker / systemd + nginx

## 🆓 免费对象存储推荐

my-pan 的**轻量级**设计使其完美契合免费对象存储服务——服务端不传输文件数据，Worker 免费额度（每日 10 万请求）完全够用。通过**多存储管理**，可将分散的免费存储聚合成统一网盘，突破单平台容量限制。

以下是永久免费的云对象存储：


| 平台                                                                   | 容量       | 亮点                                           |
| -------------------------------------------------------------------- | -------- | -------------------------------------------- |
| [Oracle Cloud](https://www.oracle.com/cloud/storage/object-storage/) | **20GB** | 每月 1 千万次请求                                   |
| [Cloudflare R2](https://developers.cloudflare.com/r2/)               | **10GB** | 出站免流量费，100 万次读 / 100 万次写                     |



## 📖 许可证

MIT