#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
RUN_SEED=0
SKIP_BUILD=0
COMPOSE_CMD=()

usage() {
  cat <<USAGE
Usage: scripts/migrate.sh [options]

Options:
  --env-file <path>  Use a specific env file (default: .env)
  --skip-build       Skip docker image build
  --seed             Run seed after migration
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
    --seed)
      RUN_SEED=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
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
      if [[ "$status" == "exited" || "$status" == "dead" ]]; then
        echo "MySQL is not healthy (status: $status)." >&2
        return 1
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

  if [[ $SKIP_BUILD -eq 0 ]]; then
    "${COMPOSE_CMD[@]}" build app
  fi

  "${COMPOSE_CMD[@]}" up -d mysql
  wait_for_mysql

  "${COMPOSE_CMD[@]}" run --rm migrate

  if [[ $RUN_SEED -eq 1 ]]; then
    "${COMPOSE_CMD[@]}" run --rm seed
  fi

  echo "Migration complete."
}

main
