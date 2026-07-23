import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

export const dynamic = 'force-dynamic';

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const query = new URLSearchParams({ investorId: investor.id });
    return NextResponse.json(
      await personalAgentInternalFetch(`/internal/billing/summary?${query.toString()}`)
    );
  } catch (error) {
    console.error('Failed to load billing summary:', error);
    return NextResponse.json({ error: 'Billing details are temporarily unavailable.' }, { status: 503 });
  }
}
