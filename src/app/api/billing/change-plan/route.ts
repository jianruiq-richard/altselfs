import { randomUUID } from 'node:crypto';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

export async function POST(request: Request) {
  const investor = await getInvestorOrNull();
  if (!investor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    return Response.json(await personalAgentInternalFetch('/internal/billing/stripe/change-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        email: investor.email,
        name: investor.name || investor.nickname,
        planKey: body.planKey,
        billingCycle: body.billingCycle,
        analytics: body.analytics,
        requestId: randomUUID(),
      }),
    }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Plan change could not be started.' },
      { status: 502 },
    );
  }
}
