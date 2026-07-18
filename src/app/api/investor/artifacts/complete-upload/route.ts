import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { getThreadMessagesPage } from '@/lib/agent-session';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

const PERSONAL_AGENT_TYPE = 'PERSONAL';

function normalizeArtifactIds(value: unknown) {
  const rawItems = Array.isArray(value) ? value : [];
  return Array.from(new Set(
    rawItems
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
        const record = item as Record<string, unknown>;
        return typeof record.id === 'string' ? record.id.trim() : typeof record.artifactId === 'string' ? record.artifactId.trim() : '';
      })
      .filter(Boolean)
  ));
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
  const artifactIds = normalizeArtifactIds(body.artifactIds || body.artifacts);
  if (!threadId) return NextResponse.json({ error: 'threadId is required' }, { status: 400 });
  if (artifactIds.length === 0) return NextResponse.json({ error: 'artifactIds are required' }, { status: 400 });

  const thread = await getThreadMessagesPage({
    investorId: investor.id,
    agentType: PERSONAL_AGENT_TYPE,
    threadId,
    limit: 1,
  });
  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

  try {
    const data = await personalAgentInternalFetch('/internal/artifacts/complete-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        userId: investor.email || investor.id,
        threadId,
        artifactIds,
      }),
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to complete upload' },
      { status: 502 }
    );
  }
}
