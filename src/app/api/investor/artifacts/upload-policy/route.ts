import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { ensureThread } from '@/lib/agent-session';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

const PERSONAL_AGENT_TYPE = 'PERSONAL';

type UploadPolicyResponse = {
  ok?: boolean;
  maxFileBytes?: number;
  artifacts?: unknown[];
  error?: string;
};

function normalizeFiles(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const mimeType = typeof record.mimeType === 'string' ? record.mimeType.trim() : typeof record.type === 'string' ? record.type.trim() : '';
      const sizeBytes = typeof record.sizeBytes === 'number' ? record.sizeBytes : typeof record.size === 'number' ? record.size : 0;
      if (!name || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
      return {
        name,
        mimeType: mimeType || 'application/octet-stream',
        sizeBytes: Math.floor(sizeBytes),
      };
    })
    .filter(Boolean);
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const files = normalizeFiles(body.files);
  if (files.length === 0) return NextResponse.json({ error: 'files are required' }, { status: 400 });

  let thread: Awaited<ReturnType<typeof ensureThread>>;
  try {
    thread = await ensureThread({
      investorId: investor.id,
      agentType: PERSONAL_AGENT_TYPE,
      threadId: typeof body.threadId === 'string' ? body.threadId.trim() || null : null,
    });
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Thread is unavailable.' },
      { status }
    );
  }

  try {
    const data = await personalAgentInternalFetch<UploadPolicyResponse>('/internal/artifacts/upload-policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        userId: investor.email || investor.id,
        threadId: thread.id,
        files,
      }),
    });
    return NextResponse.json({
      threadId: thread.id,
      ...data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create upload policy' },
      { status: 502 }
    );
  }
}
