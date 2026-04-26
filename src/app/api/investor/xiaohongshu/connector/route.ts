import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInvestorOrNull } from '@/lib/investor-auth';

const XHS_PROVIDER = 'XIAOHONGSHU';
const MAX_COOKIES_LENGTH = 20000;
const ACCEPTED_XHS_AUTH_COOKIES = ['a1', 'web_session', 'webId'];

type ConnectorBody = {
  cookies?: unknown;
  accountName?: unknown;
  connectionMethod?: unknown;
};

function hasSupportedXhsAuthCookie(cookies: string) {
  return ACCEPTED_XHS_AUTH_COOKIES.some((name) => cookies.includes(`${name}=`));
}

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const integration = await prisma.investorIntegration.findUnique({
    where: { investorId_provider: { investorId: investor.id, provider: XHS_PROVIDER } },
    select: {
      id: true,
      provider: true,
      status: true,
      accountName: true,
      scope: true,
      accessToken: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    integration: {
      enabled: Boolean(integration),
      connected: Boolean(integration?.accessToken),
      accountName: integration?.accountName || '',
      connectionMethod: integration?.scope || null,
      updatedAt: integration?.updatedAt?.toISOString() || null,
    },
  });
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as ConnectorBody | null;
  const cookies = typeof body?.cookies === 'string' ? body.cookies.trim() : '';
  const accountName =
    typeof body?.accountName === 'string' && body.accountName.trim() ? body.accountName.trim() : '小红书浏览器授权';
  const connectionMethod =
    typeof body?.connectionMethod === 'string' && body.connectionMethod.trim()
      ? body.connectionMethod.trim()
      : 'browser_extension';

  if (!cookies) {
    return NextResponse.json({ error: '缺少小红书 Cookie' }, { status: 400 });
  }
  if (cookies.length > MAX_COOKIES_LENGTH) {
    return NextResponse.json({ error: `Cookie 长度超限（>${MAX_COOKIES_LENGTH}）` }, { status: 400 });
  }
  if (!hasSupportedXhsAuthCookie(cookies)) {
    return NextResponse.json(
      { error: `Cookie 缺少可用登录态，至少需要其一：${ACCEPTED_XHS_AUTH_COOKIES.join(' / ')}` },
      { status: 400 }
    );
  }

  const integration = await prisma.investorIntegration.upsert({
    where: { investorId_provider: { investorId: investor.id, provider: XHS_PROVIDER } },
    update: {
      status: 'CONNECTED',
      accountName,
      accessToken: cookies,
      scope: connectionMethod,
    },
    create: {
      investorId: investor.id,
      provider: XHS_PROVIDER,
      status: 'CONNECTED',
      accountName,
      accessToken: cookies,
      scope: connectionMethod,
    },
  });

  return NextResponse.json({
    ok: true,
    integration: {
      connected: true,
      accountName: integration.accountName || '',
      connectionMethod: integration.scope || null,
      updatedAt: integration.updatedAt.toISOString(),
    },
  });
}

export async function DELETE() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const integration = await prisma.investorIntegration.findUnique({
    where: { investorId_provider: { investorId: investor.id, provider: XHS_PROVIDER } },
    select: {
      id: true,
      assistantCustomPrompt: true,
    },
  });

  if (!integration) {
    return NextResponse.json({ ok: true });
  }

  await prisma.investorIntegration.update({
    where: { id: integration.id },
    data: {
      status: 'DISCONNECTED',
      accountName: null,
      accessToken: null,
      scope: null,
    },
  });

  return NextResponse.json({ ok: true });
}
