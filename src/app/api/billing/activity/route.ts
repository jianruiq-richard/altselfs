import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { ServerTiming } from '@/lib/server-timing';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const timing = new ServerTiming('api.billing.activity');
  const investor = await getInvestorOrNull(timing);
  if (!investor) return timing.finish(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

  const query = new URLSearchParams({ investorId: investor.id });
  const source = req.nextUrl.searchParams.get('source')?.trim().toLowerCase();
  const cursor = req.nextUrl.searchParams.get('cursor')?.trim();
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 20);
  query.set('source', source === 'desktop' || source === 'intelligence' ? source : 'all');
  query.set('limit', String(Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20))));
  if (cursor) query.set('cursor', cursor);
  for (const key of ['from', 'to', 'agent', 'model']) {
    const value = req.nextUrl.searchParams.get(key);
    if (value) query.set(key, value.slice(0, 150));
  }

  try {
    const activity = await timing.time(
      'upstream_billing_activity',
      () => personalAgentInternalFetch(`/internal/billing/activity?${query.toString()}`),
      'personal-agent billing activity',
    );
    return timing.finish(NextResponse.json(activity));
  } catch (error) {
    console.error('Failed to load billing activity:', error);
    return timing.finish(NextResponse.json(
      { error: 'Usage history is temporarily unavailable.' },
      { status: 503 },
    ));
  }
}
