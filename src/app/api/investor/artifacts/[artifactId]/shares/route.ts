import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { getThreadMessagesPage } from '@/lib/agent-session';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

const PERSONAL_AGENT_TYPE = 'PERSONAL';

type CreateShareResponse = {
  ok?: boolean;
  token?: string;
  share?: {
    id?: string;
    expiresAt?: string;
  };
  artifact?: {
    id?: string;
    name?: string;
  };
  error?: string;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ artifactId: string }> }
) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { artifactId } = await ctx.params;
  if (!artifactId) return NextResponse.json({ error: 'artifactId is required' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
  if (threadId) {
    const thread = await getThreadMessagesPage({
      investorId: investor.id,
      agentType: PERSONAL_AGENT_TYPE,
      threadId,
      limit: 1,
    });
    if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  try {
    const data = await personalAgentInternalFetch<CreateShareResponse>('/internal/artifacts/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        artifactId,
        threadId: threadId || undefined,
      }),
    }, {
      attempts: 1,
    });
    if (!data.token || !data.share?.id || !data.share.expiresAt) {
      return NextResponse.json({ error: data.error || 'Share link unavailable' }, { status: 502 });
    }
    const shareUrl = new URL(`/s/${encodeURIComponent(data.token)}`, publicAppOrigin(req)).toString();
    return NextResponse.json({
      ok: true,
      share: {
        id: data.share.id,
        artifactId: data.artifact?.id || artifactId,
        name: data.artifact?.name || null,
        url: shareUrl,
        expiresAt: data.share.expiresAt,
      },
    }, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const upstreamStatus = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create share link' },
      { status: upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 502 }
    );
  }
}

function publicAppOrigin(req: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall back to the request origin when local configuration is incomplete.
    }
  }
  return req.nextUrl.origin;
}
