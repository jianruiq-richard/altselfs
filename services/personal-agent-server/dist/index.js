import { AgentRegistry } from './agent-registry.js';
import { loadConfig } from './config.js';
import { CodexAgentRuntime } from './codex/codex-agent-runtime.js';
import { HermesRouter } from './hermes-router.js';
import { createHttpServer } from './http-server.js';
import { HermesSourceRuntime } from './hermes/source-hermes-runtime.js';
import { InMemoryMemoryStore } from './memory-store.js';
import { MemoryReviewWorker } from './memory-review-queue.js';
import { PersonalMainAgent } from './main-agent.js';
import { createStores } from './storage.js';
import { AgentTurnQueueWorker } from './turn-queue-worker.js';
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
if (config.processRole === 'api' || config.processRole === 'all') {
    const server = createHttpServer(agent, config, stores.memoryReviewJobStore);
    server.listen(config.port, () => {
        console.log(`[personal-agent-server] listening on :${config.port}`);
        console.log(`[personal-agent-server] role=${config.processRole} env=${config.env} codexBin=${config.codexBin}`);
        console.log(`[personal-agent-server] hermesModel=${config.hermesModel} router=${config.hermesRouterEnabled ? 'enabled' : 'disabled'}`);
        console.log(`[personal-agent-server] hermesSourceRuntime=${config.hermesSourceRuntimeEnabled ? 'enabled' : 'disabled'}`);
        console.log(`[personal-agent-server] storage=${config.storageBackend} memoryReviewMode=${config.memoryReviewMode} jobStore=${config.memoryReviewJobStorePath}`);
        console.log(`[personal-agent-server] runtimeStateSync=${config.runtimeStateSyncEnabled ? 'enabled' : 'disabled'} mode=${config.runtimeStateMode} sandboxRoot=${config.sandboxStorageRoot} cacheTtlMs=${config.runtimeStateCacheTtlMs}`);
    });
}
if (config.processRole === 'worker' || config.processRole === 'all') {
    const turnQueueWorker = new AgentTurnQueueWorker(agent, config);
    turnQueueWorker.start();
    const memoryReviewWorker = new MemoryReviewWorker(config, stores.memoryReviewJobStore, stores.userProfileStore);
    memoryReviewWorker.start();
    console.log(`[personal-agent-worker] role=${config.processRole} storage=${config.storageBackend} memoryReviewMode=${config.memoryReviewMode} jobStore=${config.memoryReviewJobStorePath}`);
}
