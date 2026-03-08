# 基于官方 nginx:alpine，仅增加 wget 用于健康检查（官方镜像无 wget/curl）
FROM nginx:1.21-alpine
RUN apk add --no-cache wget
# 使用 HTTP 健康检查，确保 nginx 已正常响应
HEALTHCHECK --interval=10s --timeout=5s --start-period=25s --retries=10 \
  CMD wget -qO- http://127.0.0.1/nginx-health >/dev/null || exit 1
