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

container_id="$(docker compose --env-file .env.production -f "${COMPOSE_FILE}" ps -q semrush-traffic)"
elapsed=0
while [ "${elapsed}" -lt "${HEALTH_TIMEOUT_SECONDS}" ]; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
  case "${status}" in
    healthy|running)
      docker compose --env-file .env.production -f "${COMPOSE_FILE}" ps semrush-traffic
      printf '[semrush-deploy] deployed image=%s\n' "${ALTSELFS_SEMRUSH_TRAFFIC_IMAGE}"
      exit 0
      ;;
    unhealthy|exited|dead)
      docker logs --tail 100 "${container_id}" >&2 || true
      exit 1
      ;;
  esac
  sleep 3
  elapsed=$((elapsed + 3))
done

echo "Semrush traffic service did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s" >&2
docker logs --tail 100 "${container_id}" >&2 || true
exit 1
