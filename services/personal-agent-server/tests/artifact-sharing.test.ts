import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_ARTIFACT_SHARE_TTL_DAYS,
  agentArtifactShareExpiresAt,
  hashAgentArtifactShareSecret,
  isShareableGeneratedHtmlArtifact,
  parseAgentArtifactShareToken,
  type AgentContextArtifactRecord,
} from '../src/agent-context-store.js';

test('artifact share expiration is exactly 30 days after creation', () => {
  const now = Date.UTC(2026, 7, 26, 12, 0, 0);
  assert.equal(AGENT_ARTIFACT_SHARE_TTL_DAYS, 30);
  assert.equal(agentArtifactShareExpiresAt(now), '2026-09-25T12:00:00.000Z');
});

test('artifact share tokens require a random share id and 32-byte base64url secret', () => {
  const shareId = `shr_${'a'.repeat(32)}`;
  const secret = 'b'.repeat(43);
  assert.deepEqual(parseAgentArtifactShareToken(`${shareId}.${secret}`), { shareId, secret });
  assert.equal(parseAgentArtifactShareToken(`${shareId}.short`), null);
  assert.equal(parseAgentArtifactShareToken(`art_${'a'.repeat(32)}.${secret}`), null);
  assert.equal(parseAgentArtifactShareToken(`${shareId}.${secret}.extra`), null);
});

test('artifact share secrets are stored as deterministic sha256 hashes', () => {
  assert.equal(
    hashAgentArtifactShareSecret('secret'),
    '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b',
  );
});

test('only generated HTML artifacts are shareable', () => {
  const artifact: AgentContextArtifactRecord = {
    id: 'art_1',
    investorId: 'inv_1',
    threadId: 'thread_1',
    runId: 'run_1',
    kind: 'generated_file',
    name: 'report.htm',
    mimeType: 'application/octet-stream',
    sizeBytes: 100,
    contentText: null,
    metadata: { ossObjectKey: 'users/inv_1/report.htm' },
    createdAt: null,
    updatedAt: null,
  };
  assert.equal(isShareableGeneratedHtmlArtifact(artifact), true);
  assert.equal(isShareableGeneratedHtmlArtifact({ ...artifact, kind: 'uploaded_file' }), false);
  assert.equal(isShareableGeneratedHtmlArtifact({ ...artifact, name: 'report.pdf', mimeType: 'application/pdf' }), false);
});
