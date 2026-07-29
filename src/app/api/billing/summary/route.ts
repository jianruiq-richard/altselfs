import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { ServerTiming } from '@/lib/server-timing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const timing = new ServerTiming('api.billing.summary');
  const investor = await getInvestorOrNull(timing);
  if (!investor) return timing.finish(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

  try {
    const query = new URLSearchParams({ investorId: investor.id });
    const summary = await timing.time(
      'upstream_billing',
      () => personalAgentInternalFetch(`/internal/billing/summary?${query.toString()}`),
      'personal-agent billing summary',
    );
    return timing.finish(NextResponse.json(summary));
  } catch (error) {
    console.error('Failed to load billing summary:', error);
    return timing.finish(NextResponse.json({ error: 'Billing details are temporarily unavailable.' }, { status: 503 }));
  }
}
