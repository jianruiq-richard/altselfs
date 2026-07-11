import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const provider = req.nextUrl.searchParams.get('provider')?.trim();
  const query = new URLSearchParams({ investorId: investor.id });
  if (investor.email) query.set('userId', investor.email);
  if (provider) query.set('provider', provider);

  try {
    const data = await personalAgentInternalFetch(`/internal/personal-data/accounts?${query.toString()}`);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'personal-agent-server unavailable' },
      { status: 502 }
    );
  }
}
