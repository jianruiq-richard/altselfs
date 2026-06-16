import { AgentRegistry } from './agent-registry.js';
import { loadConfig } from './config.js';
import { CodexAgentRuntime } from './codex/codex-agent-runtime.js';
import { HermesRouter } from './hermes-router.js';
import { createHttpServer } from './http-server.js';
import { InMemoryMemoryStore } from './memory-store.js';
import { PersonalMainAgent } from './main-agent.js';

const config = loadConfig();
const registry = new AgentRegistry();
const memoryStore = new InMemoryMemoryStore();
const router = new HermesRouter(config);

registry.register(new CodexAgentRuntime(config));

const agent = new PersonalMainAgent(registry, memoryStore, router);
const server = createHttpServer(agent);

server.listen(config.port, () => {
  console.log(`[personal-agent-server] listening on :${config.port}`);
  console.log(`[personal-agent-server] env=${config.env} codexBin=${config.codexBin}`);
  console.log(`[personal-agent-server] hermesModel=${config.hermesModel} router=${config.hermesRouterEnabled ? 'enabled' : 'disabled'}`);
});
