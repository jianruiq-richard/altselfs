import fs from 'node:fs';
import type http from 'node:http';
import { AgentRegistry } from './agent-registry.js';
import { createBlueGreenGateway } from './blue-green-gateway.js';
import { loadConfig } from './config.js';
import { CodexAgentRuntime } from './codex/codex-agent-runtime.js';
import { CodexOpenAiAuthHealthMonitor } from './codex/openai-auth-health-monitor.js';
import { HermesRouter } from './hermes-router.js';
import { createHttpServer, type DeploymentControl } from './http-server.js';
import { HermesSourceRuntime } from './hermes/source-hermes-runtime.js';
import { InMemoryMemoryStore } from './memory-store.js';
import { MemoryReviewWorker } from './memory-review-queue.js';
import { PersonalMainAgent } from './main-agent.js';
import { createStores } from './storage.js';
import { AgentTurnQueueWorker } from './turn-queue-worker.js';

if (process.env.AGENT_PROCESS_ROLE?.trim().toLowerCase() === 'gateway') {
  startGateway();
} else {
  startAgentServer();
}

function startGateway() {
  const port = positiveInteger(process.env.PORT, 8787);
  const gateway = createBlueGreenGateway({
    activeColorFile: process.env.AGENT_DEPLOYMENT_ACTIVE_COLOR_FILE?.trim()
      || '/run/altselfs-deployment/active-color',
    blueUpstream: process.env.AGENT_BLUE_UPSTREAM?.trim()
      || 'http://personal-agent-server-blue:8787',
    greenUpstream: process.env.AGENT_GREEN_UPSTREAM?.trim()
      || 'http://personal-agent-server-green:8787',
  });
  gateway.listen(port, () => {
    console.log(`[personal-agent-gateway] listening on :${port}`);
  });
  installGatewayShutdown(gateway);
}

function startAgentServer() {
  const config = loadConfig();
  const registry = new AgentRegistry();
  const memoryStore = new InMemoryMemoryStore();
  const router = new HermesRouter(config);
  const stores = createStores(config);
  const sourceRuntime = config.hermesSourceRuntimeEnabled
    ? new HermesSourceRuntime(config, stores.memoryReviewJobStore, stores.userProfileStore, stores.runtimeStateStore)
    : undefined;

  registry.register(new CodexAgentRuntime(config));
  const agent = new PersonalMainAgent(registry, memoryStore, router, sourceRuntime);

  let turnQueueWorker: AgentTurnQueueWorker | undefined;
  let memoryReviewWorker: MemoryReviewWorker | undefined;
  let authHealthMonitor: CodexOpenAiAuthHealthMonitor | undefined;
  const servers: http.Server[] = [];
  const initialAccepting = shouldAcceptWorkAtStartup();
  let deploymentState: 'accepting' | 'standby' | 'draining' = initialAccepting ? 'accepting' : 'standby';
  let activeDirectTurns = 0;

  if (config.processRole === 'worker' || config.processRole === 'all') {
    authHealthMonitor = new CodexOpenAiAuthHealthMonitor(config);
    turnQueueWorker = new AgentTurnQueueWorker(agent, config);
    memoryReviewWorker = new MemoryReviewWorker(config, stores.memoryReviewJobStore, stores.userProfileStore);
  }

  const deploymentControl: DeploymentControl = {
    beginDrain() {
      deploymentState = 'draining';
      turnQueueWorker?.beginDrain();
      memoryReviewWorker?.beginDrain();
    },
    activate() {
      deploymentState = 'accepting';
      turnQueueWorker?.activate();
      memoryReviewWorker?.activate();
    },
    beginDirectTurn() {
      if (deploymentState !== 'accepting') return false;
      activeDirectTurns += 1;
      return true;
    },
    endDirectTurn() {
      activeDirectTurns = Math.max(0, activeDirectTurns - 1);
    },
    status() {
      const turnQueue = turnQueueWorker?.deploymentStatus() || null;
      const memoryReview = memoryReviewWorker?.deploymentStatus() || null;
      const claimInProgress = turnQueue?.claimInProgress || false;
      const runningTurns = turnQueue?.runningCount || 0;
      const memoryReviewProcessing = memoryReview?.processing || false;
      return {
        ok: true,
        color: process.env.AGENT_DEPLOYMENT_COLOR?.trim() || null,
        state: deploymentState,
        readyForTrafficSwitch: deploymentState !== 'accepting' && !claimInProgress,
        drained: deploymentState !== 'accepting'
          && !claimInProgress
          && runningTurns === 0
          && activeDirectTurns === 0
          && !memoryReviewProcessing,
        activeDirectTurns,
        turnQueue,
        memoryReview,
      };
    },
  };

  if (config.processRole === 'api' || config.processRole === 'all') {
    const server = createHttpServer(agent, config, stores.memoryReviewJobStore, deploymentControl);
    servers.push(server);
    server.listen(config.port, () => {
      console.log(`[personal-agent-server] listening on :${config.port}`);
      console.log(`[personal-agent-server] role=${config.processRole} env=${config.env} codexBin=${config.codexBin}`);
      console.log(`[personal-agent-server] hermesModel=${config.hermesModel} router=${config.hermesRouterEnabled ? 'enabled' : 'disabled'}`);
      console.log(`[personal-agent-server] hermesSourceRuntime=${config.hermesSourceRuntimeEnabled ? 'enabled' : 'disabled'}`);
      console.log(`[personal-agent-server] storage=${config.storageBackend} memoryReviewMode=${config.memoryReviewMode} jobStore=${config.memoryReviewJobStorePath}`);
      console.log(
        `[personal-agent-server] runtimeStateSync=${config.runtimeStateSyncEnabled ? 'enabled' : 'disabled'} mode=${config.runtimeStateMode} sandboxRoot=${config.sandboxStorageRoot} cacheTtlMs=${config.runtimeStateCacheTtlMs}`
      );
    });
  }

  if (config.processRole === 'worker') {
    const bridgeServer = createHttpServer(agent, config, stores.memoryReviewJobStore, deploymentControl);
    servers.push(bridgeServer);
    bridgeServer.listen(config.port, '127.0.0.1', () => {
      console.log(`[personal-agent-worker] internal runtime bridge listening on 127.0.0.1:${config.port}`);
    });
  }

  if (turnQueueWorker && memoryReviewWorker && authHealthMonitor) {
    authHealthMonitor.start();
    turnQueueWorker.start({ acceptingClaims: initialAccepting });
    memoryReviewWorker.start({ acceptingJobs: initialAccepting });
    console.log(
      `[personal-agent-worker] role=${config.processRole} deploymentState=${deploymentState} storage=${config.storageBackend} memoryReviewMode=${config.memoryReviewMode} jobStore=${config.memoryReviewJobStorePath}`
    );
  }

  installAgentShutdown({
    servers,
    deploymentControl,
    turnQueueWorker,
    memoryReviewWorker,
    authHealthMonitor,
  });
}

function shouldAcceptWorkAtStartup() {
  const mode = process.env.AGENT_DEPLOYMENT_INITIAL_STATE?.trim().toLowerCase();
  if (!mode || mode === 'accepting') return true;
  if (mode === 'standby') return false;
  if (mode !== 'active-color-file') return true;

  const color = process.env.AGENT_DEPLOYMENT_COLOR?.trim().toLowerCase();
  const activeColorFile = process.env.AGENT_DEPLOYMENT_ACTIVE_COLOR_FILE?.trim();
  if (!color || !activeColorFile) return false;
  try {
    return fs.readFileSync(activeColorFile, 'utf8').trim().toLowerCase() === color;
  } catch {
    return false;
  }
}

function installAgentShutdown(input: {
  servers: http.Server[];
  deploymentControl: DeploymentControl;
  turnQueueWorker?: AgentTurnQueueWorker;
  memoryReviewWorker?: MemoryReviewWorker;
  authHealthMonitor?: CodexOpenAiAuthHealthMonitor;
}) {
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[personal-agent-server] ${signal} received; draining before shutdown`);
    input.deploymentControl.beginDrain();
    for (const server of input.servers) server.close();

    const graceMs = positiveInteger(process.env.AGENT_DEPLOYMENT_SHUTDOWN_GRACE_MS, 110_000);
    const deadline = Date.now() + graceMs;
    while (!input.deploymentControl.status().drained && Date.now() < deadline) {
      await delay(500);
    }

    input.turnQueueWorker?.stop();
    input.memoryReviewWorker?.stop();
    input.authHealthMonitor?.stop();
    const drained = input.deploymentControl.status().drained;
    console.log(`[personal-agent-server] shutdown drained=${String(drained)}`);
    process.exit(drained ? 0 : 1);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

function installGatewayShutdown(server: http.Server) {
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[personal-agent-gateway] ${signal} received; closing listener`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
