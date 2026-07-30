import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { listAgentThreads } from '@/lib/agent-session';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { ServerTiming } from '@/lib/server-timing';

export const dynamic = 'force-dynamic';

const PERSONAL_AGENT_TYPE = 'PERSONAL';

type BootstrapWarning = {
  key: string;
  message: string;
};

function warningMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function settle<T>(
  warnings: BootstrapWarning[],
  key: string,
  operation: () => Promise<T>,
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    warnings.push({ key, message: warningMessage(error) });
    return null;
  }
}

export async function GET() {
  const timing = new ServerTiming('api.workspace.bootstrap');
  const investor = await getInvestorOrNull(timing);
  if (!investor) {
    return timing.finish(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const warnings: BootstrapWarning[] = [];
  const profile = {
    id: investor.id,
    email: investor.email,
    name: investor.name,
    nickname: investor.nickname,
    phone: investor.phone,
    wechatId: investor.wechatId,
    role: investor.role,
  };

  const billingCapacityPromise = settle(
    warnings,
    'billingCapacity',
    () => timing.time(
      'upstream_billing_capacity',
      () => personalAgentInternalFetch(`/internal/billing/capacity?${new URLSearchParams({ investorId: investor.id }).toString()}`),
      'personal-agent billing capacity',
    ),
  );

  const sessionsPromise = settle(
    warnings,
    'personalAgentSessions',
    () => timing.time(
      'db_sessions',
      () => listAgentThreads(investor.id, PERSONAL_AGENT_TYPE, 100, 'ACTIVE'),
      'Latest discussion list',
    ),
  );

  const [billingCapacity, sessions] = await Promise.all([
    billingCapacityPromise,
    sessionsPromise,
  ]);

  return timing.finish(NextResponse.json({
    user: profile,
    billingCapacity,
    personalAgent: {
      threadId: sessions?.[0]?.id || null,
      sessions: sessions || [],
    },
    warnings,
  }));
}
