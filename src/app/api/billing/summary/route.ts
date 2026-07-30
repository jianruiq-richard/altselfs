import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { ServerTiming } from '@/lib/server-timing';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const timing = new ServerTiming('api.billing.summary');
  const investor = await getInvestorOrNull(timing);
  if (!investor) return timing.finish(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

  try {
    const query = new URLSearchParams({ investorId: investor.id });
    const requestedSection = req.nextUrl.searchParams.get('section')?.trim().toLowerCase();
    const section = requestedSection === 'overview' || requestedSection === 'details'
      ? requestedSection
      : '';
    if (section && section !== 'overview') query.set('section', section);
    const upstreamPath = section === 'overview'
      ? `/internal/billing/capacity?${query.toString()}`
      : `/internal/billing/summary?${query.toString()}`;
    const summary = await timing.time(
      section ? `upstream_billing_${section}` : 'upstream_billing',
      () => personalAgentInternalFetch(upstreamPath),
      section ? `personal-agent billing ${section}` : 'personal-agent billing summary',
    );
    return timing.finish(NextResponse.json(summary));
  } catch (error) {
    console.error('Failed to load billing summary:', error);
    return timing.finish(NextResponse.json({ error: 'Billing details are temporarily unavailable.' }, { status: 503 }));
  }
}
