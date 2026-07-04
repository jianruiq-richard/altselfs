# Altselfs Alibaba Cloud ACR Deployment

This folder documents the ACR-based deployment path for `personal-agent-server`.

## Repositories

ACR Personal Edition repositories:

- `crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/codex-app-server`
- `crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/hermes-runtime`
- `crpi-pvisgh9yojd87fkj.cn-hangzhou.personal.cr.aliyuncs.com/altselfs/personal-agent-server`

## Build Order

Build in this order:

1. `codex-app-server`
2. `hermes-runtime`
3. `personal-agent-server`

The `personal-agent-server` image copies runtime artifacts from the first two images.

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
```

Run:

```bash
cd /opt/altselfs/personal-agent-server-docker
bash deploy-personal-agent-server.sh
```

The deploy script only pulls the ACR image and restarts the service. It does not rebuild images on ECS.
