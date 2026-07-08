import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

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
      body: JSON.stringify({ investorId: investor.id, connectionId }),
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'personal-agent-server unavailable' },
      { status: 502 }
    );
  }
}
