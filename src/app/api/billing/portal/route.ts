import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

export async function POST() {
  const investor = await getInvestorOrNull();
  if (!investor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json(await personalAgentInternalFetch('/internal/billing/stripe/portal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        email: investor.email,
        name: investor.name || investor.nickname,
      }),
    }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Billing portal could not be opened.' },
      { status: 502 },
    );
  }
}
