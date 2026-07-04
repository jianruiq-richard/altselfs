#!/usr/bin/env bash
set -euo pipefail

ACR_REGISTRY="${ACR_REGISTRY:-crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-altselfs}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_DIR="${APP_DIR:-/opt/altselfs/personal-agent-server-docker}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.acr.yml}"
ALTSELFS_PERSONAL_AGENT_IMAGE="${ALTSELFS_PERSONAL_AGENT_IMAGE:-${ACR_REGISTRY}/${ACR_NAMESPACE}/personal-agent-server:${IMAGE_TAG}}"

mkdir -p "${APP_DIR}"
cd "${APP_DIR}"

if [ ! -f ".env.production" ]; then
  echo "Missing ${APP_DIR}/.env.production; keep production secrets on the ECS host." >&2
  exit 1
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "Missing ${APP_DIR}/${COMPOSE_FILE}; upload services/personal-agent-server/docker-compose.acr.yml first." >&2
  exit 1
fi

docker pull "${ALTSELFS_PERSONAL_AGENT_IMAGE}"
ALTSELFS_PERSONAL_AGENT_IMAGE="${ALTSELFS_PERSONAL_AGENT_IMAGE}" docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans
docker image prune -f >/dev/null
docker compose -f "${COMPOSE_FILE}" ps
