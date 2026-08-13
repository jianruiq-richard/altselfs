import fs from 'node:fs';
import { Client } from 'pg';

const CLAIM_LOCK_SQL = "hashtext('altselfs_agent_turn_queue_claim')";

async function main() {
  const mode = process.argv[2]?.trim();
  const connectionString = process.env.AGENT_CONTEXT_DATABASE_URL?.trim();
  if (!connectionString) throw new Error('AGENT_CONTEXT_DATABASE_URL is required');

  const client = new Client({ connectionString });
  await client.connect();

  if (mode === 'count') {
    const turns = await client.query(
      "select count(*)::integer as count from agent_context_runs where status in ('RUNNING', 'CANCELLING')",
    );
    let memoryReviewCount = 0;
    try {
      const memoryReviews = await client.query(
        "select count(*)::integer as count from agent_memory_review_jobs where status = 'running' or billing_status = 'processing'",
      );
      memoryReviewCount = Number(memoryReviews.rows[0]?.count || 0);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
      if (code !== '42P01' && code !== '42703') throw error;
    }
    console.log(String(Number(turns.rows[0]?.count || 0) + memoryReviewCount));
    await client.end();
    return;
  }

  if (mode !== 'barrier') {
    await client.end();
    throw new Error('Usage: deployment-queue-guard <barrier READY_FILE|count>');
  }

  const readyFile = process.argv[3]?.trim();
  if (!readyFile) {
    await client.end();
    throw new Error('barrier mode requires READY_FILE');
  }

  await client.query(`select pg_advisory_lock(${CLAIM_LOCK_SQL})`);
  fs.writeFileSync(readyFile, `${process.pid}\n`, { mode: 0o644 });
  console.log(`[deployment-queue-guard] queue claim barrier acquired pid=${process.pid}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await client.query(`select pg_advisory_unlock(${CLAIM_LOCK_SQL})`);
    } finally {
      try {
        fs.unlinkSync(readyFile);
      } catch {
        // The deploy script may already have removed a stale marker.
      }
      await client.end().catch(() => undefined);
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
  setInterval(() => undefined, 60_000);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
