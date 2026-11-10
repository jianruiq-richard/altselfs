import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const investor = await getInvestorOrNull();
  if (!investor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const query = new URLSearchParams({ investorId: investor.id, kind: params.get('kind') === 'adjustments' ? 'adjustments' : 'payments', limit: '20' });
  if (params.get('cursor')) query.set('cursor', params.get('cursor')!);
  try { return Response.json(await personalAgentInternalFetch(`/internal/billing/history?${query}`)); }
  catch { return Response.json({ error: 'Billing history is temporarily unavailable.' }, { status: 503 }); }
}
