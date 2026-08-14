#!/usr/bin/env bash
set -euo pipefail

ACR_REGISTRY="${ACR_REGISTRY:-crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-altselfs}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_DIR="${APP_DIR:-/opt/altselfs/personal-agent-server-docker}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.acr.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-personal-agent-server-docker}"
ALTSELFS_PERSONAL_AGENT_IMAGE="${ALTSELFS_PERSONAL_AGENT_IMAGE:-${ACR_REGISTRY}/${ACR_NAMESPACE}/personal-agent-server:${IMAGE_TAG}}"
HERMES_EXPERT_SKILLS_ROOT="${HERMES_EXPERT_SKILLS_ROOT:-/data/altselfs-expert-skills}"
HERMES_SKILLS_ARCHIVE="${HERMES_SKILLS_ARCHIVE:-}"
HERMES_SKILLS_RELEASE_ID="${HERMES_SKILLS_RELEASE_ID:-git-${IMAGE_TAG}}"
HERMES_EXPERT_SKILLS_HOST_DIR="${HERMES_EXPERT_SKILLS_HOST_DIR:-${HERMES_EXPERT_SKILLS_ROOT}/current/skills}"
AGENT_DEPLOYMENT_STATE_HOST_DIR="${AGENT_DEPLOYMENT_STATE_HOST_DIR:-/data/altselfs-agent-deployment}"
DEPLOY_HEALTH_TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-180}"
DEPLOY_DRAIN_TIMEOUT_SECONDS="${DEPLOY_DRAIN_TIMEOUT_SECONDS:-5400}"
DEPLOY_SWITCH_TIMEOUT_SECONDS="${DEPLOY_SWITCH_TIMEOUT_SECONDS:-30}"
DEPLOY_POLL_SECONDS="${DEPLOY_POLL_SECONDS:-3}"
DEPLOY_CODEX_MODEL_PROVIDER="${DEPLOY_CODEX_MODEL_PROVIDER:-openai}"
DEPLOY_CODEX_APIYI_BASE_URL="${DEPLOY_CODEX_APIYI_BASE_URL:-https://vip.apiyi.com/v1}"
DEPLOY_CODEX_APIYI_API_KEY_ENV="${DEPLOY_CODEX_APIYI_API_KEY_ENV:-CODEX_APIYI_API_KEY}"
DEPLOY_AGENT_CONCURRENCY="${DEPLOY_AGENT_CONCURRENCY:-3}"

CURRENT_SKILLS_LINK="${HERMES_EXPERT_SKILLS_ROOT}/current"
ACTIVE_COLOR_FILE="${AGENT_DEPLOYMENT_STATE_HOST_DIR}/active-color"
BARRIER_READY_FILE="/run/altselfs-deployment/queue-claim-barrier.ready"
STAGING_DIR=""
BARRIER_CONTAINER_ID=""
NEW_SKILLS_HOST_DIR=""

export COMPOSE_PROJECT_NAME AGENT_DEPLOYMENT_STATE_HOST_DIR

cleanup() {
  if [ -n "${BARRIER_CONTAINER_ID}" ]; then
    release_queue_claim_barrier "${BARRIER_CONTAINER_ID}" || true
  fi
  if [ -n "${STAGING_DIR}" ] && [ -d "${STAGING_DIR}" ]; then
    rm -rf -- "${STAGING_DIR}"
  fi
}
trap cleanup EXIT

log() {
  printf '[blue-green-deploy] %s\n' "$*"
}

set_runtime_env() {
  local key="$1"
  local value="$2"
  local env_file="${APP_DIR}/.env.production"
  local next_file="${env_file}.next.$$"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      if (!replaced) print key "=" value
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print key "=" value }
  ' "${env_file}" > "${next_file}"
  chmod --reference="${env_file}" "${next_file}"
  mv -f "${next_file}" "${env_file}"
}

configure_runtime_limits_and_codex_provider() {
  case "${DEPLOY_CODEX_MODEL_PROVIDER}" in
    apiyi|openai|openrouter) ;;
    *)
      echo "Unsupported DEPLOY_CODEX_MODEL_PROVIDER: ${DEPLOY_CODEX_MODEL_PROVIDER}" >&2
      return 1
      ;;
  esac
  if ! [[ "${DEPLOY_AGENT_CONCURRENCY}" =~ ^[1-9][0-9]*$ ]]; then
    echo "DEPLOY_AGENT_CONCURRENCY must be a positive integer." >&2
    return 1
  fi

  if [ "${DEPLOY_CODEX_MODEL_PROVIDER}" = "apiyi" ]; then
    if ! awk -F= -v key="${DEPLOY_CODEX_APIYI_API_KEY_ENV}" '
      $1 == key {
        value = substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]"'\'' ]+|[[:space:]"'\'' ]+$/, "", value)
        if (length(value) > 0) found = 1
      }
      END { exit(found ? 0 : 1) }
    ' "${APP_DIR}/.env.production"; then
      echo "${DEPLOY_CODEX_APIYI_API_KEY_ENV} must be set in ${APP_DIR}/.env.production before deploying APIYi Codex." >&2
      return 1
    fi
  fi

  set_runtime_env CODEX_MODEL_PROVIDER "${DEPLOY_CODEX_MODEL_PROVIDER}"
  set_runtime_env CODEX_APIYI_BASE_URL "${DEPLOY_CODEX_APIYI_BASE_URL}"
  set_runtime_env CODEX_APIYI_API_KEY_ENV "${DEPLOY_CODEX_APIYI_API_KEY_ENV}"
  set_runtime_env AGENT_TURN_MAX_CONCURRENCY "${DEPLOY_AGENT_CONCURRENCY}"
  set_runtime_env AGENT_TURN_MAX_PER_USER "${DEPLOY_AGENT_CONCURRENCY}"
  set_runtime_env AGENT_TURN_MAX_PER_THREAD 1
  set_runtime_env AGENT_TURN_MAX_OPENAI "${DEPLOY_AGENT_CONCURRENCY}"
  set_runtime_env AGENT_TURN_MAX_OPENROUTER "${DEPLOY_AGENT_CONCURRENCY}"
  set_runtime_env AGENT_TURN_MAX_APIYI "${DEPLOY_AGENT_CONCURRENCY}"
  set_runtime_env HERMES_OPENROUTER_PROVIDERS_ONLY friendli

  if [ "${DEPLOY_CODEX_MODEL_PROVIDER}" = "apiyi" ]; then
    log "runtime provider=apiyi endpoint=${DEPLOY_CODEX_APIYI_BASE_URL} concurrency=${DEPLOY_AGENT_CONCURRENCY} perThread=1"
  else
    log "runtime provider=${DEPLOY_CODEX_MODEL_PROVIDER} concurrency=${DEPLOY_AGENT_CONCURRENCY} perThread=1"
  fi
}

validate_color() {
  [ "$1" = "blue" ] || [ "$1" = "green" ]
}

other_color() {
  if [ "$1" = "blue" ]; then
    printf 'green\n'
  else
    printf 'blue\n'
  fi
}

service_for_color() {
  printf 'personal-agent-server-%s\n' "$1"
}

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
  if [ -L "${link_path}" ]; then
    rm -- "${link_path}"
  fi
  mv -- "${next_link}" "${link_path}"
}

atomic_write_color() {
  local color="$1"
  local next_file="${ACTIVE_COLOR_FILE}.next.$$"
  validate_color "${color}"
  printf '%s\n' "${color}" > "${next_file}"
  mv -f "${next_file}" "${ACTIVE_COLOR_FILE}"
}

install_skill_release() {
  if [ -z "${HERMES_SKILLS_ARCHIVE}" ]; then
    validate_skill_tree "${HERMES_EXPERT_SKILLS_HOST_DIR}"
    NEW_SKILLS_HOST_DIR="$(readlink -f "${HERMES_EXPERT_SKILLS_HOST_DIR}")"
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
  if [ -e "${CURRENT_SKILLS_LINK}" ] && [ ! -L "${CURRENT_SKILLS_LINK}" ]; then
    echo "Refusing to replace non-symlink Skill current path: ${CURRENT_SKILLS_LINK}" >&2
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

  NEW_SKILLS_HOST_DIR="${release_dir}/skills"
  validate_skill_tree "${NEW_SKILLS_HOST_DIR}"
}

publish_current_skill_release() {
  if [ -z "${HERMES_SKILLS_ARCHIVE}" ]; then
    return
  fi
  if [ -e "${CURRENT_SKILLS_LINK}" ] && [ ! -L "${CURRENT_SKILLS_LINK}" ]; then
    echo "Refusing to replace non-symlink Skill current path: ${CURRENT_SKILLS_LINK}" >&2
    return 1
  fi
  replace_symlink "releases/${HERMES_SKILLS_RELEASE_ID}" "${CURRENT_SKILLS_LINK}"
}

compose_service_container() {
  docker compose -f "${COMPOSE_FILE}" ps -q "$1" 2>/dev/null || true
}

start_color() {
  local color="$1"
  local service
  service="$(service_for_color "${color}")"
  if [ "${color}" = "blue" ]; then
    ALTSELFS_PERSONAL_AGENT_BLUE_IMAGE="${ALTSELFS_PERSONAL_AGENT_IMAGE}" \
    HERMES_EXPERT_SKILLS_BLUE_HOST_DIR="${NEW_SKILLS_HOST_DIR}" \
      docker compose -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate "${service}"
  else
    ALTSELFS_PERSONAL_AGENT_GREEN_IMAGE="${ALTSELFS_PERSONAL_AGENT_IMAGE}" \
    HERMES_EXPERT_SKILLS_GREEN_HOST_DIR="${NEW_SKILLS_HOST_DIR}" \
      docker compose -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate "${service}"
  fi
}

start_gateway() {
  ALTSELFS_PERSONAL_AGENT_GATEWAY_IMAGE="${ALTSELFS_PERSONAL_AGENT_IMAGE}" \
    docker compose -f "${COMPOSE_FILE}" up -d --no-deps personal-agent-gateway
}

wait_for_healthy_container() {
  local container_id="$1"
  local label="$2"
  local elapsed=0
  while [ "${elapsed}" -lt "${DEPLOY_HEALTH_TIMEOUT_SECONDS}" ]; do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
    case "${status}" in
      healthy|running)
        return 0
        ;;
      unhealthy|exited|dead)
        echo "${label} entered terminal health state: ${status}" >&2
        return 1
        ;;
    esac
    sleep "${DEPLOY_POLL_SECONDS}"
    elapsed=$((elapsed + DEPLOY_POLL_SECONDS))
  done
  echo "${label} did not become healthy within ${DEPLOY_HEALTH_TIMEOUT_SECONDS}s" >&2
  return 1
}

validate_container_runtime_dependencies() {
  local container_id="$1"
  local label="$2"
  local runtime_summary
  if ! runtime_summary="$(docker exec "${container_id}" sh -eu -c '
    tirith_bin="${TIRITH_BIN:-/usr/local/bin/tirith}"
    test -x "${tirith_bin}"
    expected_version="${TIRITH_EXPECTED_VERSION:?TIRITH_EXPECTED_VERSION is missing}"
    actual_version="$("${tirith_bin}" --version)"
    test "${actual_version}" = "tirith ${expected_version}"
    test "${ALTSELFS_HERMES_DISABLE_BUNDLED_PLUGIN_AUTOLOAD:-}" = "1"

    metadata_cache="${HERMES_OPENROUTER_MODEL_METADATA_CACHE_PATH:?HERMES_OPENROUTER_MODEL_METADATA_CACHE_PATH is missing}"
    case "${metadata_cache}" in
      /data/altselfs-agent/shared-cache/*) ;;
      *) echo "Unsafe shared OpenRouter metadata cache path: ${metadata_cache}" >&2; exit 1 ;;
    esac
    metadata_count="$(
      cd /opt/altselfs/hermes-agent
      /opt/altselfs/hermes-agent/.venv/bin/python -c \
        "from agent.model_metadata import fetch_model_metadata; data = fetch_model_metadata(); print(len(data)); raise SystemExit(0 if data else 1)"
    )"
    test -s "${metadata_cache}"
    printf "%s; openrouterMetadata=%s" "${actual_version}" "${metadata_count}"
  ')"; then
    echo "${label} is healthy but one or more pinned Hermes runtime dependencies are unavailable or invalid." >&2
    return 1
  fi
  log "${label} runtime dependencies verified: ${runtime_summary}"
}

backend_control() {
  local container_id="$1"
  local action="$2"
  docker exec "${container_id}" node -e \
    "fetch('http://127.0.0.1:8787/internal/deployment/${action}',{method:'POST'}).then(async r=>{const t=await r.text();if(!r.ok){console.error(t);process.exit(1)}console.log(t)}).catch(e=>{console.error(e.message);process.exit(1)})"
}

backend_condition() {
  local container_id="$1"
  local field="$2"
  docker exec "${container_id}" node -e \
    "fetch('http://127.0.0.1:8787/internal/deployment/status').then(r=>r.json()).then(j=>process.exit(j['${field}']===true?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1
}

gateway_routes_color() {
  local container_id="$1"
  local color="$2"
  docker exec "${container_id}" node -e \
    "fetch('http://127.0.0.1:8787/healthz').then(async r=>{const j=await r.json();process.exit(r.ok&&j.activeColor==='${color}'?0:1)}).catch(()=>process.exit(1))" \
    >/dev/null 2>&1
}

wait_for_gateway_color() {
  local container_id="$1"
  local color="$2"
  local elapsed=0
  while [ "${elapsed}" -lt "${DEPLOY_SWITCH_TIMEOUT_SECONDS}" ]; do
    if gateway_routes_color "${container_id}" "${color}"; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "Gateway did not route to ${color} within ${DEPLOY_SWITCH_TIMEOUT_SECONDS}s" >&2
  return 1
}

wait_for_backend_condition() {
  local container_id="$1"
  local field="$2"
  local timeout_seconds="$3"
  local label="$4"
  local elapsed=0
  while [ "${elapsed}" -lt "${timeout_seconds}" ]; do
    if backend_condition "${container_id}" "${field}"; then
      return 0
    fi
    local running
    running="$(docker inspect --format '{{.State.Running}}' "${container_id}" 2>/dev/null || true)"
    if [ "${running}" != "true" ]; then
      echo "${label} stopped before reaching ${field}" >&2
      return 1
    fi
    sleep "${DEPLOY_POLL_SECONDS}"
    elapsed=$((elapsed + DEPLOY_POLL_SECONDS))
  done
  echo "${label} did not reach ${field} within ${timeout_seconds}s" >&2
  return 1
}

stop_color() {
  local color="$1"
  docker compose -f "${COMPOSE_FILE}" stop --timeout 120 "$(service_for_color "${color}")"
}

find_legacy_container() {
  docker ps -q \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
    --filter 'label=com.docker.compose.service=personal-agent-server' \
    | head -n 1
}

start_queue_claim_barrier() {
  local container_id="$1"
  docker exec "${container_id}" node -e \
    "const fs=require('fs');try{fs.unlinkSync('${BARRIER_READY_FILE}')}catch{}" >/dev/null
  docker exec -d "${container_id}" node dist/deployment-queue-guard.js barrier "${BARRIER_READY_FILE}"
  local elapsed=0
  while [ "${elapsed}" -lt "${DEPLOY_SWITCH_TIMEOUT_SECONDS}" ]; do
    if docker exec "${container_id}" test -f "${BARRIER_READY_FILE}"; then
      BARRIER_CONTAINER_ID="${container_id}"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "Queue claim barrier did not become ready" >&2
  return 1
}

release_queue_claim_barrier() {
  local container_id="$1"
  docker exec "${container_id}" node -e \
    "const fs=require('fs');try{const p=Number(fs.readFileSync('${BARRIER_READY_FILE}','utf8').trim());if(p>0)process.kill(p,'SIGTERM')}catch{}" \
    >/dev/null 2>&1 || true
  BARRIER_CONTAINER_ID=""
}

queue_claim_barrier_alive() {
  local container_id="$1"
  docker exec "${container_id}" node -e \
    "const fs=require('fs');try{const p=Number(fs.readFileSync('${BARRIER_READY_FILE}','utf8').trim());process.kill(p,0);process.exit(0)}catch{process.exit(1)}" \
    >/dev/null 2>&1
}

wait_for_global_running_zero() {
  local container_id="$1"
  local elapsed=0
  while [ "${elapsed}" -lt "${DEPLOY_DRAIN_TIMEOUT_SECONDS}" ]; do
    if ! queue_claim_barrier_alive "${container_id}"; then
      echo "Queue claim barrier exited before the legacy deployment drained" >&2
      return 1
    fi
    local count
    count="$(docker exec "${container_id}" node dist/deployment-queue-guard.js count)"
    if [ "${count}" = "0" ]; then
      return 0
    fi
    log "legacy migration waiting for ${count} running task(s)"
    sleep "${DEPLOY_POLL_SECONDS}"
    elapsed=$((elapsed + DEPLOY_POLL_SECONDS))
  done
  echo "Legacy tasks did not drain within ${DEPLOY_DRAIN_TIMEOUT_SECONDS}s" >&2
  return 1
}

rollback_bootstrap() {
  local legacy_container_id="$1"
  local target_color="$2"
  log "bootstrap failed; restoring the legacy listener"
  docker compose -f "${COMPOSE_FILE}" stop --timeout 15 personal-agent-gateway >/dev/null 2>&1 || true
  rm -f -- "${ACTIVE_COLOR_FILE}"
  if [ -n "${legacy_container_id}" ]; then
    docker start "${legacy_container_id}" >/dev/null || true
  fi
  release_queue_claim_barrier "$(compose_service_container "$(service_for_color "${target_color}")")" || true
  stop_color "${target_color}" >/dev/null 2>&1 || true
}

bootstrap_blue_green() {
  local target_color="blue"
  local target_service
  target_service="$(service_for_color "${target_color}")"
  local target_container_id
  local legacy_container_id
  legacy_container_id="$(find_legacy_container)"

  # A stale color file without a gateway must not activate the bootstrap
  # backend before the legacy claim barrier is in place.
  rm -f -- "${ACTIVE_COLOR_FILE}"
  log "bootstrapping blue-green deployment with ${target_color} in standby"
  start_color "${target_color}"
  target_container_id="$(compose_service_container "${target_service}")"
  if [ -z "${target_container_id}" ] \
    || ! wait_for_healthy_container "${target_container_id}" "${target_service}" \
    || ! validate_container_runtime_dependencies "${target_container_id}" "${target_service}"; then
    stop_color "${target_color}" >/dev/null 2>&1 || true
    return 1
  fi

  if [ -n "${legacy_container_id}" ]; then
    log "blocking legacy queue claims and draining existing tasks"
    if ! start_queue_claim_barrier "${target_container_id}"; then
      stop_color "${target_color}" >/dev/null 2>&1 || true
      return 1
    fi
    if ! wait_for_global_running_zero "${target_container_id}"; then
      release_queue_claim_barrier "${target_container_id}" || true
      stop_color "${target_color}" >/dev/null 2>&1 || true
      return 1
    fi
    docker stop --time 120 "${legacy_container_id}" >/dev/null
  fi

  atomic_write_color "${target_color}"
  if ! start_gateway; then
    rollback_bootstrap "${legacy_container_id}" "${target_color}"
    return 1
  fi
  local gateway_container_id
  gateway_container_id="$(compose_service_container personal-agent-gateway)"
  if [ -z "${gateway_container_id}" ] || ! wait_for_healthy_container "${gateway_container_id}" personal-agent-gateway; then
    rollback_bootstrap "${legacy_container_id}" "${target_color}"
    return 1
  fi
  if ! backend_control "${target_container_id}" activate >/dev/null; then
    rollback_bootstrap "${legacy_container_id}" "${target_color}"
    return 1
  fi
  release_queue_claim_barrier "${target_container_id}"
  if ! publish_current_skill_release; then
    echo "The new container is active with its pinned Skill release, but the current Skill symlink was not updated." >&2
  fi
  log "blue-green gateway active on ${target_color}"
}

ensure_inactive_color_replaceable() {
  local color="$1"
  local service
  service="$(service_for_color "${color}")"
  local container_id
  container_id="$(compose_service_container "${service}")"
  if [ -z "${container_id}" ]; then
    return 0
  fi
  local running
  running="$(docker inspect --format '{{.State.Running}}' "${container_id}" 2>/dev/null || true)"
  if [ "${running}" != "true" ]; then
    return 0
  fi
  if ! backend_condition "${container_id}" drained; then
    log "inactive ${color} still has work; waiting before reusing that slot"
    wait_for_backend_condition "${container_id}" drained "${DEPLOY_DRAIN_TIMEOUT_SECONDS}" "${service}"
  fi
  stop_color "${color}"
}

deploy_next_color() {
  local active_color="$1"
  local target_color
  target_color="$(other_color "${active_color}")"
  local active_service target_service
  active_service="$(service_for_color "${active_color}")"
  target_service="$(service_for_color "${target_color}")"

  local active_container_id target_container_id gateway_container_id
  active_container_id="$(compose_service_container "${active_service}")"
  gateway_container_id="$(compose_service_container personal-agent-gateway)"
  if [ -z "${active_container_id}" ] || [ -z "${gateway_container_id}" ]; then
    echo "Active blue-green containers are incomplete; refusing an unsafe update." >&2
    return 1
  fi

  # Recover an interrupted deployment where the active color file changed
  # before the new worker received its activate command. Activation is
  # idempotent for an already-active worker.
  backend_control "${active_container_id}" activate >/dev/null

  ensure_inactive_color_replaceable "${target_color}"
  log "starting ${target_color} in standby with image ${ALTSELFS_PERSONAL_AGENT_IMAGE}"
  start_color "${target_color}"
  target_container_id="$(compose_service_container "${target_service}")"
  if [ -z "${target_container_id}" ] \
    || ! wait_for_healthy_container "${target_container_id}" "${target_service}" \
    || ! validate_container_runtime_dependencies "${target_container_id}" "${target_service}"; then
    stop_color "${target_color}" >/dev/null 2>&1 || true
    return 1
  fi

  log "draining claims on ${active_color}"
  if ! backend_control "${active_container_id}" drain >/dev/null; then
    stop_color "${target_color}" >/dev/null 2>&1 || true
    return 1
  fi
  if ! wait_for_backend_condition "${active_container_id}" readyForTrafficSwitch \
    "${DEPLOY_SWITCH_TIMEOUT_SECONDS}" "${active_service}"; then
    backend_control "${active_container_id}" activate >/dev/null 2>&1 || true
    stop_color "${target_color}" >/dev/null 2>&1 || true
    return 1
  fi

  log "switching traffic ${active_color} -> ${target_color}"
  atomic_write_color "${target_color}"
  if ! wait_for_gateway_color "${gateway_container_id}" "${target_color}"; then
    atomic_write_color "${active_color}"
    backend_control "${active_container_id}" activate >/dev/null 2>&1 || true
    stop_color "${target_color}" >/dev/null 2>&1 || true
    return 1
  fi
  if ! backend_control "${target_container_id}" activate >/dev/null; then
    atomic_write_color "${active_color}"
    backend_control "${active_container_id}" activate >/dev/null 2>&1 || true
    stop_color "${target_color}" >/dev/null 2>&1 || true
    return 1
  fi
  if ! publish_current_skill_release; then
    echo "The new container is active with its pinned Skill release, but the current Skill symlink was not updated." >&2
  fi

  log "${target_color} is serving new tasks; waiting for ${active_color} in-flight tasks to finish"
  if ! wait_for_backend_condition "${active_container_id}" drained \
    "${DEPLOY_DRAIN_TIMEOUT_SECONDS}" "${active_service}"; then
    echo "New deployment is active, but ${active_color} is still draining; it was left running." >&2
    return 0
  fi
  stop_color "${active_color}"
  log "${active_color} drained and stopped"
}

mkdir -p "${APP_DIR}" "${AGENT_DEPLOYMENT_STATE_HOST_DIR}"
cd "${APP_DIR}"

if command -v flock >/dev/null 2>&1; then
  exec 9>"${APP_DIR}/.deploy.lock"
  if ! flock -n 9; then
    echo "Another personal-agent-server deployment is already running." >&2
    exit 1
  fi
fi

if [ ! -f ".env.production" ]; then
  echo "Missing ${APP_DIR}/.env.production; keep production secrets on the ECS host." >&2
  exit 1
fi
if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "Missing ${APP_DIR}/${COMPOSE_FILE}; upload docker-compose.acr.yml first." >&2
  exit 1
fi
configure_runtime_limits_and_codex_provider
docker compose -f "${COMPOSE_FILE}" config >/dev/null

install_skill_release
log "pulling image without touching the active containers"
docker pull "${ALTSELFS_PERSONAL_AGENT_IMAGE}"

active_color=""
if [ -f "${ACTIVE_COLOR_FILE}" ]; then
  active_color="$(tr -d '[:space:]' < "${ACTIVE_COLOR_FILE}")"
fi

if validate_color "${active_color}" \
  && [ -n "$(compose_service_container personal-agent-gateway)" ]; then
  deploy_next_color "${active_color}"
else
  bootstrap_blue_green
fi

docker image prune -f >/dev/null
docker compose -f "${COMPOSE_FILE}" ps
log "deployed image=${ALTSELFS_PERSONAL_AGENT_IMAGE} activeColor=$(tr -d '[:space:]' < "${ACTIVE_COLOR_FILE}")"
log "active Skill release=$(readlink "${CURRENT_SKILLS_LINK}" 2>/dev/null || printf '%s' "${NEW_SKILLS_HOST_DIR}")"
