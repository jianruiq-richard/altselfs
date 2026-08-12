#!/usr/bin/env bash
set -euo pipefail

ACR_REGISTRY="${ACR_REGISTRY:-crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-altselfs}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_DIR="${APP_DIR:-/opt/altselfs/personal-agent-server-docker}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.acr.yml}"
ALTSELFS_PERSONAL_AGENT_IMAGE="${ALTSELFS_PERSONAL_AGENT_IMAGE:-${ACR_REGISTRY}/${ACR_NAMESPACE}/personal-agent-server:${IMAGE_TAG}}"
HERMES_EXPERT_SKILLS_ROOT="${HERMES_EXPERT_SKILLS_ROOT:-/data/altselfs-expert-skills}"
HERMES_SKILLS_ARCHIVE="${HERMES_SKILLS_ARCHIVE:-}"
HERMES_SKILLS_RELEASE_ID="${HERMES_SKILLS_RELEASE_ID:-git-${IMAGE_TAG}}"
HERMES_EXPERT_SKILLS_HOST_DIR="${HERMES_EXPERT_SKILLS_HOST_DIR:-${HERMES_EXPERT_SKILLS_ROOT}/current/skills}"
DEPLOY_HEALTH_TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-180}"

CURRENT_LINK="${HERMES_EXPERT_SKILLS_ROOT}/current"
PREVIOUS_SKILLS_TARGET=""
PREVIOUS_IMAGE=""
PREVIOUS_IMAGE_ROLLBACK_TAG=""
STAGING_DIR=""

cleanup() {
  if [ -n "${STAGING_DIR}" ] && [ -d "${STAGING_DIR}" ]; then
    rm -rf -- "${STAGING_DIR}"
  fi
}
trap cleanup EXIT

validate_skill_tree() {
  local skills_dir="$1"
  if [ ! -d "${skills_dir}" ]; then
    echo "Missing external Hermes Skill release: ${skills_dir}" >&2
    return 1
  fi
  if [ -z "$(find "${skills_dir}" -type f -name SKILL.md -print -quit)" ]; then
    echo "No SKILL.md found under ${skills_dir}" >&2
    return 1
  fi
}

sha256_file() {
  local file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{print $1}'
  else
    shasum -a 256 "${file_path}" | awk '{print $1}'
  fi
}

replace_symlink() {
  local target="$1"
  local link_path="$2"
  local next_link="${link_path}.next.$$"
  ln -s "${target}" "${next_link}"
  if mv -Tf "${next_link}" "${link_path}" 2>/dev/null; then
    return
  fi
  # BSD mv has no -T. This fallback is only used by local validation; ECS uses
  # GNU coreutils and takes the atomic branch above.
  if [ -L "${link_path}" ]; then
    rm -- "${link_path}"
  fi
  mv -- "${next_link}" "${link_path}"
}

install_skill_release() {
  if [ -z "${HERMES_SKILLS_ARCHIVE}" ]; then
    validate_skill_tree "${HERMES_EXPERT_SKILLS_HOST_DIR}"
    return
  fi

  if [[ ! "${HERMES_SKILLS_RELEASE_ID}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Invalid HERMES_SKILLS_RELEASE_ID: ${HERMES_SKILLS_RELEASE_ID}" >&2
    exit 1
  fi
  if [ ! -f "${HERMES_SKILLS_ARCHIVE}" ]; then
    echo "Missing HERMES_SKILLS_ARCHIVE: ${HERMES_SKILLS_ARCHIVE}" >&2
    exit 1
  fi
  local archive_listing
  archive_listing="$(tar -tzf "${HERMES_SKILLS_ARCHIVE}")"
  if grep -Eq '(^/|(^|/)\.\.(/|$))' <<< "${archive_listing}"; then
    echo "Unsafe path found in HERMES_SKILLS_ARCHIVE" >&2
    exit 1
  fi

  local releases_dir="${HERMES_EXPERT_SKILLS_ROOT}/releases"
  local release_dir="${releases_dir}/${HERMES_SKILLS_RELEASE_ID}"
  local archive_sha256
  archive_sha256="$(sha256_file "${HERMES_SKILLS_ARCHIVE}")"
  mkdir -p "${releases_dir}"

  if [ -d "${release_dir}" ]; then
    local installed_sha256
    installed_sha256="$(cat "${release_dir}/ARCHIVE_SHA256" 2>/dev/null || true)"
    if [ "${installed_sha256}" != "${archive_sha256}" ]; then
      echo "Skill release ${HERMES_SKILLS_RELEASE_ID} already exists with different content." >&2
      exit 1
    fi
  else
    STAGING_DIR="$(mktemp -d "${HERMES_EXPERT_SKILLS_ROOT}/.staging-${HERMES_SKILLS_RELEASE_ID}.XXXXXX")"
    tar -xzf "${HERMES_SKILLS_ARCHIVE}" -C "${STAGING_DIR}"
    validate_skill_tree "${STAGING_DIR}/skills"
    printf '%s\n' "${HERMES_SKILLS_RELEASE_ID}" > "${STAGING_DIR}/RELEASE_ID"
    printf '%s\n' "${archive_sha256}" > "${STAGING_DIR}/ARCHIVE_SHA256"
    chmod -R u=rwX,go=rX "${STAGING_DIR}"
    mv "${STAGING_DIR}" "${release_dir}"
    STAGING_DIR=""
  fi

  validate_skill_tree "${release_dir}/skills"
  HERMES_EXPERT_SKILLS_HOST_DIR="${CURRENT_LINK}/skills"
}

switch_skill_release() {
  if [ -z "${HERMES_SKILLS_ARCHIVE}" ]; then
    return
  fi
  if [ -e "${CURRENT_LINK}" ] && [ ! -L "${CURRENT_LINK}" ]; then
    echo "Refusing to replace non-symlink Skill current path: ${CURRENT_LINK}" >&2
    exit 1
  fi
  if [ -L "${CURRENT_LINK}" ]; then
    PREVIOUS_SKILLS_TARGET="$(readlink "${CURRENT_LINK}")"
  fi

  replace_symlink "releases/${HERMES_SKILLS_RELEASE_ID}" "${CURRENT_LINK}"
}

restore_previous_release() {
  if [ -z "${HERMES_SKILLS_ARCHIVE}" ]; then
    return
  fi
  if [ -n "${PREVIOUS_SKILLS_TARGET}" ]; then
    replace_symlink "${PREVIOUS_SKILLS_TARGET}" "${CURRENT_LINK}"
  elif [ -L "${CURRENT_LINK}" ]; then
    rm -- "${CURRENT_LINK}"
  fi
}

wait_for_healthy_container() {
  local container_id="$1"
  local elapsed=0
  while [ "${elapsed}" -lt "${DEPLOY_HEALTH_TIMEOUT_SECONDS}" ]; do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
    case "${status}" in
      healthy|running)
        return 0
        ;;
      unhealthy|exited|dead)
        echo "Container entered terminal health state: ${status}" >&2
        return 1
        ;;
    esac
    sleep 3
    elapsed=$((elapsed + 3))
  done
  echo "Container did not become healthy within ${DEPLOY_HEALTH_TIMEOUT_SECONDS}s" >&2
  return 1
}

rollback_deployment() {
  echo "Deployment failed; restoring the previous Skill release and image." >&2
  restore_previous_release
  if [ -n "${PREVIOUS_IMAGE}" ]; then
    ALTSELFS_PERSONAL_AGENT_IMAGE="${PREVIOUS_IMAGE}" \
    HERMES_EXPERT_SKILLS_HOST_DIR="${HERMES_EXPERT_SKILLS_HOST_DIR}" \
      docker compose -f "${COMPOSE_FILE}" up -d --force-recreate --remove-orphans || true
  fi
}

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

install_skill_release

current_container_id="$(docker compose -f "${COMPOSE_FILE}" ps -q personal-agent-server 2>/dev/null || true)"
if [ -n "${current_container_id}" ]; then
  previous_image_id="$(docker inspect --format '{{.Image}}' "${current_container_id}" 2>/dev/null || true)"
  if [ -n "${previous_image_id}" ]; then
    PREVIOUS_IMAGE_ROLLBACK_TAG="altselfs/personal-agent-server:rollback-before-${HERMES_SKILLS_RELEASE_ID}"
    docker tag "${previous_image_id}" "${PREVIOUS_IMAGE_ROLLBACK_TAG}"
    PREVIOUS_IMAGE="${PREVIOUS_IMAGE_ROLLBACK_TAG}"
  fi
fi

# Pull the immutable image before switching the Skill symlink. A pull failure
# therefore leaves the running deployment and its knowledge version untouched.
docker pull "${ALTSELFS_PERSONAL_AGENT_IMAGE}"
switch_skill_release

if ! ALTSELFS_PERSONAL_AGENT_IMAGE="${ALTSELFS_PERSONAL_AGENT_IMAGE}" \
  HERMES_EXPERT_SKILLS_HOST_DIR="${HERMES_EXPERT_SKILLS_HOST_DIR}" \
  docker compose -f "${COMPOSE_FILE}" up -d --force-recreate --remove-orphans; then
  rollback_deployment
  exit 1
fi

new_container_id="$(docker compose -f "${COMPOSE_FILE}" ps -q personal-agent-server)"
if [ -z "${new_container_id}" ] || ! wait_for_healthy_container "${new_container_id}"; then
  rollback_deployment
  exit 1
fi

docker image prune -f >/dev/null
if [ -n "${PREVIOUS_IMAGE_ROLLBACK_TAG}" ]; then
  docker image rm "${PREVIOUS_IMAGE_ROLLBACK_TAG}" >/dev/null 2>&1 || true
fi
docker compose -f "${COMPOSE_FILE}" ps
echo "Deployed image: ${ALTSELFS_PERSONAL_AGENT_IMAGE}"
echo "Active Skill release: $(readlink "${CURRENT_LINK}" 2>/dev/null || printf '%s' "${HERMES_EXPERT_SKILLS_HOST_DIR}")"
