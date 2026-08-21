import { runRapidApiCompetitortool } from '../dist/tools/rapidapi-competitor.js';

const [toolName, rawArguments = '{}'] = process.argv.slice(2);

if (!toolName) {
  throw new Error('Usage: node scripts/run-rapidapi-competitor.mjs <tool-name> [arguments-json]');
}

let argumentsValue;
try {
  argumentsValue = JSON.parse(rawArguments);
} catch (error) {
  throw new Error(`Arguments must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const timeout = Number(process.env.RAPIDAPI_REQUEST_TIMEOUT_MS || 30_000);
const config = {
  rapidApiKeyEnv: process.env.RAPIDAPI_KEY_ENV || 'RAPIDAPI_KEY',
  rapidApiRequestTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000,
};

process.stdout.write(await runRapidApiCompetitortool(toolName, argumentsValue, config));
