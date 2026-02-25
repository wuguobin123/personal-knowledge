#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] docker 未安装，请先安装 Docker 与 Docker Compose 插件。" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] 未找到 $ENV_FILE" >&2
  echo "请先执行: cp .env.example .env 并填入参数，或通过 ENV_FILE 指定环境文件。" >&2
  exit 1
fi

echo "[INFO] 使用环境文件: $ENV_FILE"
if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans; then
  echo "[ERROR] 部署失败。若日志包含 registry-1.docker.io 超时，可在环境文件中配置镜像地址:" >&2
  echo "NODE_IMAGE=node:20-alpine" >&2
  echo "MYSQL_IMAGE=mysql:8.0" >&2
  echo "NGINX_IMAGE=nginx:1.21-alpine" >&2
  echo "阿里云加速地址需配置在 Docker daemon（不能直接写成 NODE_IMAGE）:" >&2
  echo "/etc/docker/daemon.json => {\"registry-mirrors\":[\"https://him7zrbc.mirror.aliyuncs.com\"]}" >&2
  echo "若无法修改 daemon，可改用镜像站完整镜像名，例如:" >&2
  echo "NODE_IMAGE=docker.1ms.run/library/node:20-alpine" >&2
  echo "MYSQL_IMAGE=docker.1ms.run/library/mysql:8.0" >&2
  echo "NGINX_IMAGE=docker.1ms.run/library/nginx:1.21-alpine" >&2
  exit 1
fi

echo "[INFO] 当前服务状态"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "[INFO] 部署完成，查看日志:"
echo "docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs -f"
