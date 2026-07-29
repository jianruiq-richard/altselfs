import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { ServerTiming } from '@/lib/server-timing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const timing = new ServerTiming('api.billing.capacity');
  const investor = await getInvestorOrNull(timing);
  if (!investor) return timing.finish(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

  try {
    const query = new URLSearchParams({ investorId: investor.id });
    const capacity = await timing.time(
      'upstream_billing',
      () => personalAgentInternalFetch(`/internal/billing/capacity?${query.toString()}`),
      'personal-agent billing capacity',
    );
    return timing.finish(NextResponse.json(capacity));
  } catch (error) {
    console.error('Failed to load billing capacity:', error);
    return timing.finish(NextResponse.json({ error: 'Task capacity is temporarily unavailable.' }, { status: 503 }));
  }
}
