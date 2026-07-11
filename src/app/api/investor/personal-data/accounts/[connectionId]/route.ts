import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

const FEISHU_FEATURE_PACKAGES = ['messages', 'contacts', 'calendar', 'docs', 'meetings'] as const;

function normalizeFeaturePackages(value: unknown) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(FEISHU_FEATURE_PACKAGES);
  return value
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter((item, index, items) => allowed.has(item) && items.indexOf(item) === index);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> }
) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { connectionId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { featurePackages?: unknown };
  try {
    const data = await personalAgentInternalFetch('/internal/personal-data/feishu-cli/feature-packages', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        userId: investor.email || investor.id,
        connectionId,
        featurePackages: normalizeFeaturePackages(body.featurePackages),
      }),
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'personal-agent-server unavailable' },
      { status: 502 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> }
) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { connectionId } = await ctx.params;
  try {
    const data = await personalAgentInternalFetch('/internal/personal-data/connections', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ investorId: investor.id, userId: investor.email || investor.id, connectionId }),
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'personal-agent-server unavailable' },
      { status: 502 }
    );
  }
}
