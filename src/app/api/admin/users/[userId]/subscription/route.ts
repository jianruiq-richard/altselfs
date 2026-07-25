import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAdmin } from '@/lib/ops-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const admin = await requireOpsAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { userId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await personalAgentInternalFetch('/internal/admin/billing/subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        investorId: userId,
        planKey: typeof body.planKey === 'string' ? body.planKey : '',
        status: typeof body.status === 'string' ? body.status : '',
        monthlyCredits: typeof body.monthlyCredits === 'number' ? body.monthlyCredits : Number(body.monthlyCredits),
        currentPeriodStart: typeof body.currentPeriodStart === 'string' ? body.currentPeriodStart : null,
        currentPeriodEnd: typeof body.currentPeriodEnd === 'string' ? body.currentPeriodEnd : null,
        provider: typeof body.provider === 'string' ? body.provider : null,
        providerCustomerId: typeof body.providerCustomerId === 'string' ? body.providerCustomerId : null,
        providerSubscriptionId: typeof body.providerSubscriptionId === 'string' ? body.providerSubscriptionId : null,
        reason: typeof body.reason === 'string' ? body.reason : '',
        admin,
      }),
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = getErrorStatus(error);
    console.error('[admin-users] subscription update failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update subscription' },
      { status },
    );
  }
}

function getErrorStatus(error: unknown) {
  if (typeof error === 'object' && error && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    if (Number.isFinite(status) && status >= 400 && status < 600) return status;
  }
  return 500;
}
