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
      await personalAgentInternalFetch(`/internal/billing/capacity?${query.toString()}`)
    );
  } catch (error) {
    console.error('Failed to load billing capacity:', error);
    return NextResponse.json({ error: 'Task capacity is temporarily unavailable.' }, { status: 503 });
  }
}
