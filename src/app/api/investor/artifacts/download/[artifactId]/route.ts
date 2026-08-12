import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { getThreadMessagesPage } from '@/lib/agent-session';
import {
  artifactContentDisposition,
  GENERATED_HTML_PREVIEW_CSP,
  isHtmlArtifact,
  type ArtifactDeliveryMode,
} from '@/lib/artifact-delivery';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

const PERSONAL_AGENT_TYPE = 'PERSONAL';

type DownloadUrlResponse = {
  ok?: boolean;
  url?: string;
  artifact?: {
    name?: string | null;
    mimeType?: string | null;
  };
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
  const mode = readDeliveryMode(req.nextUrl.searchParams.get('mode'));
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
    const artifactName = data.artifact?.name?.trim() || 'report.html';
    if (mode && isHtmlArtifact(artifactName, data.artifact?.mimeType)) {
      const upstream = await fetch(data.url, {
        cache: 'no-store',
        redirect: 'follow',
      });
      if (!upstream.ok || !upstream.body) {
        return NextResponse.json({ error: 'HTML artifact is unavailable' }, { status: 502 });
      }
      const headers = new Headers({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': artifactContentDisposition(mode, artifactName),
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      if (mode === 'preview') {
        headers.set('Content-Security-Policy', GENERATED_HTML_PREVIEW_CSP);
        headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
      }
      return new Response(upstream.body, { status: 200, headers });
    }
    return NextResponse.redirect(data.url);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create download URL' },
      { status: 502 }
    );
  }
}

function readDeliveryMode(value: string | null): ArtifactDeliveryMode | null {
  return value === 'preview' || value === 'download' ? value : null;
}
