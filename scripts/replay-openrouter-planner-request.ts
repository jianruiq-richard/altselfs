import { readFileSync } from 'fs';
import 'dotenv/config';
import { createJsonChatCompletion, type ChatMessage } from '@/lib/openrouter';
import { EXECUTIVE_PLANNER_JSON_SCHEMA } from '@/lib/agents/executive-orchestrator';

async function main() {
  const tracePath = process.argv[2] || '.debug/openrouter-traces/2026-06-04.jsonl';

  const rows = readFileSync(tracePath, 'utf8')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  const plannerError = rows.find((row) => row.type === 'json' && row.status === 'error' && row.model === 'deepseek/deepseek-v3.2');
  if (!plannerError) {
    throw new Error(`No failed planner json trace found in ${tracePath}`);
  }

  const messages = plannerError.messages as ChatMessage[];
  const startedAt = Date.now();
  const raw = await createJsonChatCompletion(messages, 'deepseek/deepseek-v3.2', {
    maxTokens: 12000,
    jsonSchema: EXECUTIVE_PLANNER_JSON_SCHEMA,
  });
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    parsed = {
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  console.log(
    JSON.stringify(
      {
        replayedFrom: {
          timestamp: plannerError.timestamp,
          model: plannerError.model,
          error: plannerError.error,
        },
        result: {
          ok: true,
          durationMs: Date.now() - startedAt,
          outputLength: raw.length,
          outputPreview: raw.slice(0, 1200),
          parsedTopLevelKeys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed as Record<string, unknown>) : null,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
