#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
RUN_SEED=0
SKIP_BUILD=0
SKIP_PULL=0
SKIP_HEALTH_CHECK=0
COMPOSE_CMD=()

usage() {
  cat <<USAGE
Usage: scripts/deploy.sh [options]

Options:
  --env-file <path>   Use a specific env file (default: .env)
  --seed              Run seed after migration
  --skip-build        Skip docker image build
  --skip-pull         Skip docker pull mysql
  --skip-health-check Skip app health check
  -h, --help          Show this help
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
    --skip-pull)
      SKIP_PULL=1
      shift
      ;;
    --skip-health-check)
      SKIP_HEALTH_CHECK=1
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
  echo "Create one from .env.example first." >&2
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

validate_env() {
  local missing=0
  local required=(
    ADMIN_USERNAME
    ADMIN_PASSWORD
    AUTH_SECRET
    MYSQL_ROOT_PASSWORD
    MYSQL_DATABASE
    MYSQL_USER
    MYSQL_PASSWORD
  )

  for key in "${required[@]}"; do
    if [[ -z "${!key:-}" ]]; then
      echo "Missing env var: $key" >&2
      missing=1
    fi
  done

  if [[ "${STORAGE_PROVIDER:-local}" == "oss" ]]; then
    local oss_required=(OSS_REGION OSS_BUCKET OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET)
    for key in "${oss_required[@]}"; do
      if [[ -z "${!key:-}" ]]; then
        echo "Missing env var for OSS: $key" >&2
        missing=1
      fi
    done
  fi

  if [[ $missing -eq 1 ]]; then
    exit 1
  fi

  if [[ "${ADMIN_PASSWORD:-}" == "admin123" || "${AUTH_SECRET:-}" == "change-this-long-random-secret" ]]; then
    echo "Warning: default credentials detected. Please replace before production rollout." >&2
  fi
}

wait_for_service_healthy() {
  local service="$1"
  local timeout_seconds="$2"

  local elapsed=0
  local cid=""
  while [[ $elapsed -lt $timeout_seconds ]]; do
    cid="$("${COMPOSE_CMD[@]}" ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      local status
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      if [[ "$status" == "healthy" || "$status" == "running" ]]; then
        return 0
      fi
      if [[ "$status" == "exited" || "$status" == "dead" ]]; then
        echo "Service $service is not healthy (status: $status)." >&2
        return 1
      fi
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "Timeout waiting for service $service to become healthy." >&2
  return 1
}

main() {
  cd "$ROOT_DIR"
  require_cmd docker
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose is unavailable." >&2
    exit 1
  fi

  load_env
  validate_env

  COMPOSE_CMD=(docker compose --env-file "$ENV_FILE")

  if [[ $SKIP_PULL -eq 0 ]]; then
    "${COMPOSE_CMD[@]}" pull mysql >/dev/null || true
  fi

  if [[ $SKIP_BUILD -eq 0 ]]; then
    "${COMPOSE_CMD[@]}" build app
  fi

  "${COMPOSE_CMD[@]}" up -d mysql

  wait_for_service_healthy mysql 180

  "${COMPOSE_CMD[@]}" run --rm migrate

  if [[ $RUN_SEED -eq 1 ]]; then
    "${COMPOSE_CMD[@]}" run --rm seed
  fi

  "${COMPOSE_CMD[@]}" up -d app nginx

  if [[ $SKIP_HEALTH_CHECK -eq 0 ]]; then
    wait_for_service_healthy app 120
    wait_for_service_healthy nginx 120
  fi

  "${COMPOSE_CMD[@]}" ps
  echo "Deployment complete."
}

main
