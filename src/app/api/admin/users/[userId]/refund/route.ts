import { requireOpsAdmin } from '@/lib/ops-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const admin = await requireOpsAdmin();
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { userId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    return Response.json(await personalAgentInternalFetch('/internal/admin/billing/refund', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        investorId: userId,
        paymentId: body.paymentId,
        reason: body.reason,
        platformFault: body.platformFault === true,
        admin,
      }),
    }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Refund could not be completed.' },
      { status: 502 },
    );
  }
}
