import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { TEAM_LIBRARY, type TeamKey } from '@/lib/team-library';

function isTeamKey(input: string): input is TeamKey {
  return TEAM_LIBRARY.some((team) => team.key === input);
}

function teamDefaultAgentName(teamKey: TeamKey) {
  return TEAM_LIBRARY.find((team) => team.key === teamKey)?.defaultAgentName || '默认AI员工';
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const contentType = req.headers.get('content-type') || '';
  let teamKey = '';
  let action = 'hire';

  if (contentType.includes('application/json')) {
    const body = (await req.json().catch(() => null)) as { teamKey?: string; action?: 'hire' | 'unhire' } | null;
    teamKey = body?.teamKey || '';
    action = body?.action || 'hire';
  } else {
    const form = await req.formData().catch(() => null);
    teamKey = String(form?.get('teamKey') || '');
    action = String(form?.get('action') || 'hire');
  }

  if (!isTeamKey(teamKey)) {
    return NextResponse.json({ error: '无效 teamKey' }, { status: 400 });
  }

  if (action === 'unhire') {
    await prisma.investorTeamHire.upsert({
      where: {
        investorId_teamKey: {
          investorId: investor.id,
          teamKey,
        },
      },
      update: {
        status: 'UNHIRED',
      },
      create: {
        investorId: investor.id,
        teamKey,
        status: 'UNHIRED',
      },
    });
  } else {
    await prisma.investorTeamHire.upsert({
      where: {
        investorId_teamKey: {
          investorId: investor.id,
          teamKey,
        },
      },
      update: {
        status: 'HIRED',
      },
      create: {
        investorId: investor.id,
        teamKey,
        status: 'HIRED',
        agentName: teamDefaultAgentName(teamKey),
      },
    });
  }

  if (contentType.includes('application/json')) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.redirect(new URL('/ai-talent', req.url), { status: 303 });
}
