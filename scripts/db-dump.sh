#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
OUTPUT_FILE=""
COMPOSE_CMD=()

usage() {
  cat <<USAGE
Usage: scripts/db-dump.sh [options]

Options:
  --env-file <path>  Use a specific env file (default: .env)
  --output <path>    Dump output file path (default: backups/mysql-YYYYmmdd-HHMMSS.sql.gz)
  -h, --help         Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --env-file" >&2
        exit 1
      fi
      ENV_FILE="$2"
      shift 2
      ;;
    --output)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --output" >&2
        exit 1
      fi
      OUTPUT_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${MYSQL_DATABASE:-}" || -z "${MYSQL_USER:-}" || -z "${MYSQL_PASSWORD:-}" ]]; then
  echo "MYSQL_DATABASE, MYSQL_USER and MYSQL_PASSWORD must be set in env file." >&2
  exit 1
fi

if [[ -z "$OUTPUT_FILE" ]]; then
  mkdir -p "$ROOT_DIR/backups"
  OUTPUT_FILE="$ROOT_DIR/backups/mysql-$(date +%Y%m%d-%H%M%S).sql.gz"
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"

wait_for_mysql() {
  local elapsed=0
  local cid=""
  while [[ $elapsed -lt 180 ]]; do
    cid="$("${COMPOSE_CMD[@]}" ps -q mysql 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      local status
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      if [[ "$status" == "healthy" || "$status" == "running" ]]; then
        return 0
      fi
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "Timeout waiting for mysql to become healthy." >&2
  return 1
}

main() {
  cd "$ROOT_DIR"
  COMPOSE_CMD=(docker compose --env-file "$ENV_FILE")

  "${COMPOSE_CMD[@]}" up -d mysql >/dev/null
  wait_for_mysql

  "${COMPOSE_CMD[@]}" exec -T mysql sh -c 'exec mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' | gzip > "$OUTPUT_FILE"

  echo "Database dump written to: $OUTPUT_FILE"
}

main
