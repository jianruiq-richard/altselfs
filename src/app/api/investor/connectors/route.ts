import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { loadInvestorConnectors } from '@/lib/investor-connectors-data';
import { ServerTiming } from '@/lib/server-timing';

export async function GET() {
  const timing = new ServerTiming('api.investor.connectors');
  const investor = await getInvestorOrNull(timing);
  if (!investor) return timing.finish(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

  try {
    const data = await loadInvestorConnectors(investor, timing);
    return timing.finish(NextResponse.json(data));
  } catch (error) {
    console.error('Failed to load connectors:', error);
    return timing.finish(NextResponse.json({ error: 'Connectors are temporarily unavailable.' }, { status: 503 }));
  }
}
