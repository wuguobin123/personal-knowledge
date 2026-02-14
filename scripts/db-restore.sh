#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
INPUT_FILE=""
COMPOSE_CMD=()

usage() {
  cat <<USAGE
Usage: scripts/db-restore.sh --input <path> [options]

Options:
  --env-file <path>  Use a specific env file (default: .env)
  --input <path>     SQL file (.sql or .sql.gz)
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
    --input)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --input" >&2
        exit 1
      fi
      INPUT_FILE="$2"
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

if [[ -z "$INPUT_FILE" ]]; then
  echo "--input is required." >&2
  usage
  exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "Input file not found: $INPUT_FILE" >&2
  exit 1
fi

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

  if [[ "$INPUT_FILE" == *.gz ]]; then
    gzip -dc "$INPUT_FILE" | "${COMPOSE_CMD[@]}" exec -T mysql sh -c 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
  else
    cat "$INPUT_FILE" | "${COMPOSE_CMD[@]}" exec -T mysql sh -c 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
  fi

  echo "Database restore complete."
}

main
