# my-pan — 轻量级个人网盘 Docker 镜像
#
# 构建:  docker build -t my-pan .
# 运行:  docker run -p 8787:8787 -e S3_LIST_JSON='[...]' my-pan

FROM node:24-alpine

WORKDIR /app/server

# 安装生产依赖（tsx 已列入 dependencies，由 lockfile 锁定版本）
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# 复制源码（保持目录结构与开发环境一致，确保相对导入 ../worker/src/ 正确解析）
COPY server/ ./
COPY worker/src/ ../worker/src/
COPY pages/public/ ../pages/public/

# SQLite 数据目录
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8787
ENV DATABASE_PATH=/app/data/my-pan.db
ENV RATE_LIMIT_PATH=/app/data/rate-limits.json

EXPOSE 8787

CMD ["npx", "--no-install", "tsx", "index.ts"]
