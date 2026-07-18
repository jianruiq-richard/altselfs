import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { getThreadMessagesPage } from '@/lib/agent-session';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

const PERSONAL_AGENT_TYPE = 'PERSONAL';

type DownloadUrlResponse = {
  ok?: boolean;
  url?: string;
  error?: string;
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ artifactId: string }> }
) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { artifactId } = await ctx.params;
  const threadId = req.nextUrl.searchParams.get('threadId')?.trim() || '';
  if (!artifactId) return NextResponse.json({ error: 'artifactId is required' }, { status: 400 });
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
    const data = await personalAgentInternalFetch<DownloadUrlResponse>('/internal/artifacts/download-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        userId: investor.email || investor.id,
        threadId: threadId || undefined,
        artifactId,
      }),
    });
    if (!data.url) {
      return NextResponse.json({ error: data.error || 'Download URL unavailable' }, { status: 404 });
    }
    return NextResponse.redirect(data.url);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create download URL' },
      { status: 502 }
    );
  }
}
