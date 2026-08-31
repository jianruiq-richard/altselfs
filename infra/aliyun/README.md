# Altselfs Alibaba Cloud ACR Deployment

This folder documents the ACR-based deployment path for `personal-agent-server`.

## Repositories

ACR Personal Edition repositories:

- `crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/codex-app-server`
- `crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/hermes-runtime`
- `crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/sandbox-exec-runtime`
- `crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/semrush-traffic-service`
- `crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/personal-agent-server`

## Build Order

Build in this order:

1. `codex-app-server`
2. `hermes-runtime`
3. `sandbox-exec-runtime`
4. `semrush-traffic-service`
5. `personal-agent-server`

The `personal-agent-server` image copies runtime artifacts from `codex-app-server`
and `hermes-runtime`. The `sandbox-exec-runtime` image is not copied into the
server image; it is pulled on the ECS host and used by `altselfs_sandbox_exec` for
short-lived Docker sandbox containers.

## ACR Build Rules

### codex-app-server

Copy `infra/aliyun/acr/codex-app-server.Dockerfile` into the Codex repository as:

```text
Dockerfile.altselfs-runtime
```

ACR build rule:

- Source repository: `jianruiq-richard/codex`
- Dockerfile path: `/Dockerfile.altselfs-runtime`
- Build context: `/`
- Image tag: `latest`

### hermes-runtime

Copy `infra/aliyun/acr/hermes-runtime.Dockerfile` into the Hermes repository as:

```text
Dockerfile.altselfs-runtime
```

ACR build rule:

- Source repository: `jianruiq-richard/hermes-agent`
- Dockerfile path: `/Dockerfile.altselfs-runtime`
- Build context: `/`
- Image tag: `latest`

### personal-agent-server

Use the Dockerfile already in the main Altselfs repository:

```text
services/personal-agent-server/Dockerfile.acr
```

ACR build rule:

- Source repository: `jianruiq-richard/altselfs`
- Dockerfile path: `Dockerfile.acr`
- Build context: `/services/personal-agent-server/`
- Image tag: `latest`

Optional build args:

```text
CODEX_RUNTIME_IMAGE=crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/codex-app-server:latest
HERMES_RUNTIME_IMAGE=crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/hermes-runtime:latest
```

### sandbox-exec-runtime

Use the Dockerfile in the main Altselfs repository:

```text
infra/aliyun/acr/sandbox-exec-runtime.Dockerfile
```

ACR build rule:

- Source repository: `jianruiq-richard/altselfs`
- Dockerfile path: `/infra/aliyun/acr/sandbox-exec-runtime.Dockerfile`
- Build context: `/`
- Image tag: `latest`

### semrush-traffic-service

Use the Dockerfile in the main Altselfs repository:

```text
services/semrush-traffic-service/Dockerfile
```

ACR build rule:

- Source repository: `jianruiq-richard/altselfs`
- Dockerfile path: `/Dockerfile`
- Build context: `/services/semrush-traffic-service/`
- Image tag: `latest`

## ECS Deploy

Login once on the ECS host:

```bash
docker login --username=nick1650584801 crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com
```

Keep production secrets in:

```text
/opt/altselfs/personal-agent-server-docker/.env.production
```

Upload:

```text
services/personal-agent-server/docker-compose.acr.yml
infra/aliyun/ecs/deploy-personal-agent-server.sh
infra/aliyun/ecs/deploy-semrush-traffic-service.sh
```

Deploy the Semrush browser worker independently when its image changes:

```bash
cd /opt/altselfs/personal-agent-server-docker
IMAGE_TAG=YOUR_SEMRUSH_IMAGE_TAG bash deploy-semrush-traffic-service.sh
```

Routine `deploy-personal-agent-server.sh` runs deliberately leave the Semrush
container untouched so its authenticated, warm Chrome session remains alive.

Run:

```bash
cd /opt/altselfs/personal-agent-server-docker
bash deploy-personal-agent-server.sh
```

The deployment remains intentionally semi-automatic. A push to `main` triggers
the existing ACR build rule. After that build succeeds, run the workspace
release helper from a clean, pushed checkout:

```bash
ECS_SSH_TARGET=root@YOUR_ECS_HOST \
bash infra/aliyun/ecs/deploy-personal-agent-server-from-workspace.sh
```

The helper validates and packages `expert-skills/skills`, uploads it together
with the Compose file and ECS deployment script, and invokes the remote deploy.
The remote script then:

1. installs an immutable `git-<commit>` Skill release;
2. pulls the requested ACR image (`latest` by default);
3. starts the inactive blue/green container with that exact Skill directory in
   standby and waits for health;
4. stops the active Worker from claiming new tasks and atomically points the
   stable gateway at the new color;
5. activates the new Worker immediately, then waits for the old color's existing
   work to drain before stopping it;
6. updates `/data/altselfs-expert-skills/current` only after the new color is
   active.

Deployment state is stored at `/data/altselfs-agent-deployment/active-color`.
The old color remains available for rollback until its existing work has
finished. `DEPLOY_DRAIN_TIMEOUT_SECONDS` defaults to 90 minutes; if it expires,
the new color remains active and the old draining container is deliberately left
running instead of being killed. The next deployment waits for that inactive
slot to become drain-safe before reusing it.

The ECS host does not rebuild images. `IMAGE_TAG` can override `latest` when an
immutable ACR tag is available.

If `SANDBOX_EXEC_ENABLED=true`, also pull the sandbox runtime image on the ECS host:

```bash
docker pull crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/sandbox-exec-runtime:latest
```

Set this in `.env.production`:

```text
SANDBOX_EXEC_IMAGE=crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/sandbox-exec-runtime:latest
```

The independent Semrush deployment script pulls and starts
`semrush-traffic-service`. Configure the Semrush variables from
`services/personal-agent-server/env.production.example`, then use an SSH tunnel
to the loopback-only noVNC port for the first login:

```bash
ssh -L 6080:127.0.0.1:6080 root@YOUR_ECS_HOST
```
