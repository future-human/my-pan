[中文](README.md) | English

# my-pan — Lightweight Personal Cloud Drive

A lightweight personal cloud drive based on **S3-compatible object storage** + **server-side signing**: the browser communicates directly with storage via presigned URLs, keeping file data off the server entirely.

> Compatible with any S3 storage (AWS S3, Oracle Cloud, MinIO, Cloudflare R2, etc.). Supports Cloudflare Workers (free tier), Docker, and self-hosted server deployments.

## ✨ Features

- **Direct Storage Access** — Browser uploads/downloads directly to/from S3 via presigned URLs; file data never passes through the server
- **Multi-Storage Management** — Manage multiple S3 backends simultaneously, switch with one click in the frontend
- **File Preview** — Online preview for images, PDFs, videos, audio, and text files, with multi-encoding support
- **File Sharing** — Password protection + expiration + QR codes, for files or folders

## 🎨 Architecture

```
Browser ─── Server (API + Static Frontend)
  │
  ├─ GET /api/storages ────────→ Return storage list (with capacity config)
  ├─ GET /api/files?storage=xx ─→ S3 file listing
  ├─ POST /api/upload-url ─────→ Issue presigned upload URL
  ├─ GET /api/files/:key ──────→ Issue presigned download URL
  ├─ GET /api/preview/:key ────→ Issue presigned preview URL
  ├─ DELETE /api/files/:key ───→ Delete file
  ├─ POST /api/shares ─────────→ Create share (requires database)
  ├─ GET /s/:id ───────────────→ Share access page (public)
  │
  ├─ PUT presigned URL ────────→ S3 direct upload (bypasses server)
  └─ GET presigned URL ────────→ S3 direct download (bypasses server)
```

The server handles AWS SigV4 signing and hosts the frontend. File data never passes through the server.

## 📦 Storage Configuration

`S3_LIST_JSON` is a JSON array, with one entry per storage backend. The same format applies to all deployment methods.

| Field              | Required | Description                                        |
| ------------------ | -------- | -------------------------------------------------- |
| `id`               | Yes      | Unique identifier, maps to URL param `?storage=<id>` |
| `name`             | Yes      | Display name in the frontend                        |
| `bucket`           | Yes      | Bucket name                                         |
| `region`           | Yes      | S3 region, e.g. `ca-toronto-1`, `auto`              |
| `endpoint`         | Yes      | S3 endpoint URL, e.g. `https://xxx.oraclecloud.com` |
| `accessKeyId`      | Yes      | S3 Access Key                                       |
| `secretAccessKey`  | Yes      | S3 Secret Key                                       |
| `capacity`         | No       | Total capacity, e.g. `"20GB"` or `"500MB"`; hides progress bar if omitted |

Example:

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

## 🚀 Deployment

### Cloudflare Workers + GitHub Actions (Recommended)

Automatically deploy to Cloudflare Workers via GitHub Actions. Push to deploy, zero cost within the free tier.

**Prerequisites**: Cloudflare account, GitHub account.

#### 1. Fork the repo and set Secrets

After forking, go to Repository Settings → Secrets and variables → Actions and add:

| Secret                  | Description                                              | Required |
| ----------------------- | -------------------------------------------------------- | -------- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID (found on Dashboard homepage)       | Yes      |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API Token (use the "Edit Cloudflare Workers" template) | Yes      |
| `S3_LIST_JSON`          | Full storage config JSON array (with keys), see [Storage Config](#-storage-configuration) | Yes      |
| `AUTH_PASSWORD`         | Frontend access password                                  | No       |
| `D1_DATABASE_NAME`      | D1 database name; enables sharing when set                 | No       |
| `KV_BINDING_ID`         | KV namespace ID; enables IP rate limiting when set         | No       |

#### 2. Trigger Deployment

Push to the master branch to auto-deploy. You can also manually Run workflow from the Actions page.

Once deployed, visit `https://my-pan.<your-subdomain>.workers.dev`.

#### 3. Custom Domain (Optional)

Cloudflare Dashboard → Workers & Pages → your Worker → Triggers → Custom Domains.

#### Local Development

```bash
cd worker
npm install
```

Create `worker/.dev.vars`:

```env
S3_LIST_JSON = '[{"id":"oracle","name":"Oracle Cloud","bucket":"bucket-xxx","region":"ca-toronto-1","endpoint":"https://xxx.oraclecloud.com","accessKeyId":"your-access-key","secretAccessKey":"your-secret-key"}]'
AUTH_PASSWORD = your-password
```

```bash
npx wrangler d1 execute my-pan --local --file=./db/schema.sql  # Create local database
npm run dev                                                     # Start at http://localhost:8787
```

---

### Docker / Docker Compose

No Node.js required — one-command containerized deployment. Prebuilt images are pushed to Docker Hub.

**Prerequisites**: Docker environment.

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

#### Environment Variables

| Variable           | Required | Default                      | Description                |
| ------------------ | -------- | ---------------------------- | -------------------------- |
| `S3_LIST_JSON`     | Yes      | —                            | Storage config JSON (with keys) |
| `AUTH_PASSWORD`    | No       | —                            | Skips auth if not set       |
| `PORT`             | No       | `8787`                       | Container listen port       |
| `DATABASE_PATH`    | No       | `/app/data/my-pan.db`        | SQLite database path        |
| `RATE_LIMIT_PATH`  | No       | `/app/data/rate-limits.json` | Rate limit persistence path |

#### Operations

```bash
docker compose up -d       # Start, visit http://localhost:8787
docker compose pull        # Pull new image
docker compose up -d       # Upgrade
```

Sharing & login state data is persisted in the `./data` directory.

---

### Self-Hosted Server (Express + SQLite)

No Cloudflare account needed — run on your own VPS.

**Prerequisites**: Node.js 18+.

#### 1. Install & Configure

```bash
cd server
npm install
```

Create `server/.env`:

```env
S3_LIST_JSON = '[{"id":"oracle","name":"Oracle Cloud","bucket":"bucket-xxx","region":"ca-toronto-1","endpoint":"https://xxx.oraclecloud.com","accessKeyId":"your-access-key","secretAccessKey":"your-secret-key"}]'
AUTH_PASSWORD = your-password
PORT = 8787
```

| Variable           | Required | Default                     | Description                |
| ------------------ | -------- | --------------------------- | -------------------------- |
| `S3_LIST_JSON`     | Yes      | —                           | Storage config JSON (with keys) |
| `AUTH_PASSWORD`    | No       | —                           | Skips auth if not set       |
| `PORT`             | No       | `8787`                      | Listen port                 |
| `DATABASE_PATH`    | No       | `./data/my-pan.db`          | SQLite database path        |
| `RATE_LIMIT_PATH`  | No       | `./data/rate-limits.json`   | Rate limit persistence path |

#### 2. Start

```bash
npm start                  # Visit http://localhost:8787
```

#### 3. Production Deployment

**Nginx Reverse Proxy**:

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

**Systemd Service** (`/etc/systemd/system/my-pan.service`):

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

## 🔧 Feature Configuration

### Sharing

| Deployment           | Storage Backend      | Configuration                              |
| -------------------- | -------------------- | ------------------------------------------ |
| Cloudflare Workers   | D1 (SQLite-compatible) | Set GitHub Secret `D1_DATABASE_NAME`      |
| Docker / Self-hosted | SQLite (sql.js)      | Auto-created `my-pan.db`, no config needed |

Once enabled, a "Share" button appears in file rows and the context menu. Supports:

- Share password
- Expiration time (1 hour ~ never)
- QR code generation
- Access count
- Share history management

### Brute-Force Protection

| Deployment           | Storage Backend           | Configuration                          |
| -------------------- | ------------------------- | -------------------------------------- |
| Cloudflare Workers   | KV                        | Set GitHub Secret `KV_BINDING_ID`      |
| Docker / Self-hosted | File (`rate-limits.json`) | Auto-persisted, no config needed       |

IP-level brute-force protection covering all auth endpoints:

| Failures   | Behavior                                                     |
| ---------- | ------------------------------------------------------------ |
| < 5        | Normal response                                               |
| 5 ~ 9      | Incremental delay: 2ⁿ⁻⁵ seconds (2s → 4s → 8s → 16s), max 30s |
| ≥ 10       | Blocked for 15 minutes, returns 429 + `Retry-After` header    |

Reset immediately on correct password. Inactive failure records auto-clean after 1 hour.

When not configured, rate limiting silently skips, with no impact on normal operation.

## 📖 API Endpoints

All file operation endpoints support the `?storage=<id>` parameter to specify the target storage.

| Endpoint                         | Method     | Auth   | Description                                                     |
| -------------------------------- | ---------- | ------ | --------------------------------------------------------------- |
| `/api/login`                     | POST       | Public | Exchange password for Token, `{password}` → `{token}`           |
| `/api/logout`                    | POST       | Auth   | Revoke current Token                                             |
| `/api/storages`                  | GET        | Auth   | Return storage list (id/name/capacity, no keys)                  |
| `/api/files`                     | GET        | Auth   | List files (S3 XML → JSON)                                       |
| `/api/files/:key`                | GET        | Auth   | Issue presigned download URL                                     |
| `/api/preview/:key`              | GET        | Auth   | Issue presigned preview URL, `?charset=gbk` for encoding         |
| `/api/upload-url`                | POST       | Auth   | Issue presigned upload URL, `{key, contentType}`                 |
| `/api/files/:key`                | DELETE     | Auth   | Delete file                                                      |
| `/api/batch-delete`              | POST       | Auth   | Batch delete, `{keys: [...]}`                                    |
| `/api/rename`                    | PUT        | Auth   | Rename/move, `{sourceKey, destinationKey}`                       |
| `/api/shares`                    | POST       | Auth   | Create share, `{fileKey, fileName, password?, expiresInHours?}`  |
| `/api/shares`                    | GET        | Auth   | List shares (`?page=&pageSize=`)                                 |
| `/api/shares/status`             | GET        | Auth   | Check sharing availability                                       |
| `/api/shares/:id`                | DELETE     | Auth   | Delete share                                                     |
| `/api/shares/batch-delete`       | POST       | Auth   | Batch delete shares                                              |
| `/api/files/:key?share_id=xx`    | GET        | Public | Shared file download                                             |
| `/api/preview/:key?share_id=xx`  | GET        | Public | Shared file preview                                              |
| `/s/:id`                         | GET/POST   | Public | Share access page                                                |

Auth: `POST /api/login` exchanges password for a Token (UUID), stored in cookies, passed via `X-Auth-Token` header in subsequent requests. Auth is skipped when `AUTH_PASSWORD` is not set.

## 🛠 Tech Stack

- **Signing**: AWS Signature V4 (HMAC-SHA256 via Web Crypto API)
- **Runtime**: Cloudflare Workers / Node.js + Express, shared core logic
- **Frontend**: Single-page HTML + Vanilla JS + CSS, zero frameworks
- **Storage**: Any S3-compatible object storage
- **Database**: Cloudflare D1 / SQLite (sql.js), only needed for sharing
- **Deployment**: GitHub Actions / Docker / systemd + nginx

## 🆓 Free Object Storage Recommendations

my-pan's **lightweight** design pairs perfectly with free-tier object storage — the server never transfers file data, and the Worker free tier (100K requests/day) is more than sufficient. With **multi-storage management**, you can aggregate multiple free storage services into a unified drive, breaking through single-platform capacity limits.

Permanently free cloud object storage:

| Platform                                                              | Capacity  | Highlights                                            |
| --------------------------------------------------------------------- | --------- | ----------------------------------------------------- |
| [Oracle Cloud](https://www.oracle.com/cloud/storage/object-storage/)  | **20GB**  | 10 million requests/month                             |
| [Cloudflare R2](https://developers.cloudflare.com/r2/)                | **10GB**  | Free egress, 1M reads / 1M writes per month           |

## 📖 License

MIT
