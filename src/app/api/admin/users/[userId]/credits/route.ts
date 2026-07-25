import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAdmin } from '@/lib/ops-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

const CREDIT_ACTIONS = new Set(['GRANT', 'DEDUCT', 'REFUND']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const admin = await requireOpsAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { userId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || '').trim().toUpperCase();
    if (!CREDIT_ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Unsupported credit action' }, { status: 400 });
    }
    const result = await personalAgentInternalFetch('/internal/admin/billing/credits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        investorId: userId,
        action,
        amountCredits: Number(body.amountCredits),
        reason: typeof body.reason === 'string' ? body.reason : '',
        admin,
      }),
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = getErrorStatus(error);
    console.error('[admin-users] credit adjustment failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to adjust credits' },
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
