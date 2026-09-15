// Explicit deployment step; never called from page or agent read paths.
import { loadConfig } from '../src/config.js';
import { initializeMarketSchema } from '../src/market-intelligence-store.js';
await initializeMarketSchema(loadConfig());
console.log('Market intelligence schema initialized.');
process.exit(0);
