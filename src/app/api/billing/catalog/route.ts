import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

export const dynamic = 'force-dynamic';

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json(await personalAgentInternalFetch('/internal/billing/catalog'));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Billing catalog is unavailable.' },
      { status: 503 },
    );
  }
}
