#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ECS_SSH_TARGET="${ECS_SSH_TARGET:-}"
ECS_SSH_PORT="${ECS_SSH_PORT:-22}"
ECS_APP_DIR="${ECS_APP_DIR:-/opt/altselfs/personal-agent-server-docker}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
ACR_IMAGE="${ACR_IMAGE:-crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/personal-agent-server}"

if [ -z "${ECS_SSH_TARGET}" ]; then
  echo "Set ECS_SSH_TARGET, for example root@ecs-host." >&2
  exit 1
fi

release_paths=(
  expert-skills
  infra/aliyun/ecs/deploy-personal-agent-server.sh
  infra/aliyun/ecs/deploy-personal-agent-server-from-workspace.sh
  services/personal-agent-server/docker-compose.acr.yml
)
if [ -n "$(git -C "${REPO_ROOT}" status --porcelain -- "${release_paths[@]}")" ]; then
  echo "Deployment inputs have uncommitted changes; commit and push them before ECS deployment." >&2
  exit 1
fi

current_branch="$(git -C "${REPO_ROOT}" branch --show-current)"
if [ "${current_branch}" != "main" ]; then
  echo "ECS production deployment requires the main branch; current branch is ${current_branch}." >&2
  exit 1
fi

upstream_sha="$(git -C "${REPO_ROOT}" rev-parse '@{upstream}' 2>/dev/null || true)"
local_sha="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
if [ -z "${upstream_sha}" ] || [ "${local_sha}" != "${upstream_sha}" ]; then
  echo "Local main must match its pushed upstream before ECS deployment." >&2
  exit 1
fi

node "${REPO_ROOT}/expert-skills/scripts/validate-skills.mjs"

commit_sha="${local_sha}"
release_id="git-${commit_sha}"
archive_dir="$(mktemp -d "/tmp/altselfs-expert-skills-${commit_sha}.XXXXXX")"
archive_path="${archive_dir}/expert-skills-${commit_sha}.tar.gz"
remote_archive="/tmp/altselfs-expert-skills-${commit_sha}.tar.gz"
trap 'rm -rf -- "${archive_dir}"' EXIT

COPYFILE_DISABLE=1 tar -cf - -C "${REPO_ROOT}/expert-skills" skills | gzip -n > "${archive_path}"

scp -P "${ECS_SSH_PORT}" \
  "${archive_path}" \
  "${REPO_ROOT}/services/personal-agent-server/docker-compose.acr.yml" \
  "${REPO_ROOT}/infra/aliyun/ecs/deploy-personal-agent-server.sh" \
  "${ECS_SSH_TARGET}:/tmp/"

ssh -p "${ECS_SSH_PORT}" "${ECS_SSH_TARGET}" \
  "set -e; \
  install -d -m 0755 '${ECS_APP_DIR}'; \
  install -m 0644 /tmp/docker-compose.acr.yml '${ECS_APP_DIR}/docker-compose.acr.yml'; \
  install -m 0755 /tmp/deploy-personal-agent-server.sh '${ECS_APP_DIR}/deploy-personal-agent-server.sh'; \
  mv '/tmp/$(basename "${archive_path}")' '${remote_archive}'; \
  APP_DIR='${ECS_APP_DIR}' \
  ALTSELFS_PERSONAL_AGENT_IMAGE='${ACR_IMAGE}:${IMAGE_TAG}' \
  IMAGE_TAG='${IMAGE_TAG}' \
  HERMES_SKILLS_RELEASE_ID='${release_id}' \
  HERMES_SKILLS_ARCHIVE='${remote_archive}' \
  bash '${ECS_APP_DIR}/deploy-personal-agent-server.sh'; \
  rm -f '${remote_archive}' /tmp/docker-compose.acr.yml /tmp/deploy-personal-agent-server.sh"

echo "ECS deployment completed: image=${ACR_IMAGE}:${IMAGE_TAG} skills=${release_id}"
