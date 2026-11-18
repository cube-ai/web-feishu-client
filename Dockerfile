# syntax=docker/dockerfile:1

# The release is prepared on the host by scripts/build-docker-image.sh:
#   pnpm build && node scripts/package-release.mjs
# Only the compiled release and production dependencies go into the image.
FROM node:24-slim

ARG APP_VERSION=0.1.0
ARG NPM_REGISTRY=https://registry.npmjs.org/
LABEL org.opencontainers.image.title="web-feishu-client" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.description="定制化飞书 Web 客户端"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8731 \
    DATA_DIR=/app/data \
    PUBLIC_BASE_URL=http://127.0.0.1:8731

WORKDIR /app

COPY dist-release/web-feishu-client-${APP_VERSION}/ ./
RUN npm config set registry "$NPM_REGISTRY" \
    && npm install --omit=dev \
    && npm cache clean --force \
    && mkdir -p /app/data

# 管理员账号、会话和机器人配置都在 /app/data，建议挂载命名卷持久化。
EXPOSE 8731
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8731/api/health').then((r) => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["npm", "start"]
