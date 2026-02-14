#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.prod}"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] docker 未安装，请先安装 Docker 与 Docker Compose 插件。" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] 未找到 $ENV_FILE" >&2
  echo "请先执行: cp .env.prod.example .env.prod 并填入生产参数。" >&2
  exit 1
fi

echo "[INFO] 使用环境文件: $ENV_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans

echo "[INFO] 当前服务状态"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "[INFO] 部署完成，查看日志:"
echo "docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs -f"
