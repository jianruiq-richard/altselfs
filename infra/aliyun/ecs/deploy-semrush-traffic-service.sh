#!/usr/bin/env bash
set -euo pipefail

ACR_REGISTRY="${ACR_REGISTRY:-crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-altselfs}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_DIR="${APP_DIR:-/opt/altselfs/personal-agent-server-docker}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.acr.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-personal-agent-server-docker}"
ALTSELFS_SEMRUSH_TRAFFIC_IMAGE="${ALTSELFS_SEMRUSH_TRAFFIC_IMAGE:-${ACR_REGISTRY}/${ACR_NAMESPACE}/semrush-traffic-service:${IMAGE_TAG}}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"

export COMPOSE_PROJECT_NAME ALTSELFS_SEMRUSH_TRAFFIC_IMAGE

cd "${APP_DIR}"
test -f .env.production
test -f "${COMPOSE_FILE}"

docker compose --env-file .env.production -f "${COMPOSE_FILE}" config >/dev/null
docker pull "${ALTSELFS_SEMRUSH_TRAFFIC_IMAGE}"
docker compose --env-file .env.production -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate semrush-traffic

wait_healthy() {
  local service="$1"
  local container_id
  local elapsed=0
  container_id="$(docker compose --env-file .env.production -f "${COMPOSE_FILE}" ps -q "${service}")"
  while [ "${elapsed}" -lt "${HEALTH_TIMEOUT_SECONDS}" ]; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
    case "${status}" in
      healthy|running)
        return 0
        ;;
      unhealthy|exited|dead)
        docker logs --tail 100 "${container_id}" >&2 || true
        return 1
        ;;
    esac
    sleep 3
    elapsed=$((elapsed + 3))
  done
  echo "${service} did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s" >&2
  docker logs --tail 100 "${container_id}" >&2 || true
  return 1
}

wait_healthy semrush-traffic
docker compose --env-file .env.production -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate \
  semrush-traffic-worker-1 semrush-traffic-worker-2 semrush-traffic-worker-3
for service in semrush-traffic-worker-1 semrush-traffic-worker-2 semrush-traffic-worker-3; do
  wait_healthy "${service}"
done
docker compose --env-file .env.production -f "${COMPOSE_FILE}" ps \
  semrush-traffic semrush-traffic-worker-1 semrush-traffic-worker-2 semrush-traffic-worker-3
printf '[semrush-deploy] deployed dispatcher and 3 workers image=%s\n' "${ALTSELFS_SEMRUSH_TRAFFIC_IMAGE}"
