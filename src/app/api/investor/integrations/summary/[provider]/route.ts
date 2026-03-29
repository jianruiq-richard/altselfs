import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInvestorOrNull } from '@/lib/investor-auth';
import {
  buildFeishuSummary,
  buildGmailSummary,
  parseProvider,
  providerToDb,
  refreshGoogleAccessToken,
  saveIntegrationSnapshot,
} from '@/lib/integrations';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const investor = await getInvestorOrNull();
  if (!investor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { provider: rawProvider } = await params;
  const provider = parseProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
  }

  const integration = await prisma.investorIntegration.findUnique({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: providerToDb(provider),
      },
    },
  });

  if (!integration || !integration.accessToken) {
    return NextResponse.json({ error: '请先绑定账户' }, { status: 400 });
  }

  try {
    let activeAccessToken = integration.accessToken;
    let expiresInForSave: number | null = null;

    if (
      provider === 'gmail' &&
      integration.refreshToken &&
      integration.expiresAt &&
      integration.expiresAt.getTime() < Date.now() + 60_000
    ) {
      const refreshed = await refreshGoogleAccessToken(integration.refreshToken);
      activeAccessToken = refreshed.access_token;
      expiresInForSave = refreshed.expires_in;
    }

    const digest =
      provider === 'gmail'
        ? await buildGmailSummary(activeAccessToken)
        : await buildFeishuSummary(activeAccessToken);

    const updated = await saveIntegrationSnapshot({
      investorId: investor.id,
      provider,
      accountEmail: digest.accountEmail || undefined,
      accountName: digest.accountName,
      accessToken: activeAccessToken,
      refreshToken: integration.refreshToken,
      scope: integration.scope,
      expiresIn: expiresInForSave,
      summary: digest.summary,
      raw: digest.raw,
    });

    const latest = await prisma.integrationSnapshot.findFirst({
      where: { integrationId: updated.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      ok: true,
      integration: {
        provider,
        accountEmail: updated.accountEmail,
        accountName: updated.accountName,
        updatedAt: updated.updatedAt,
      },
      latestSummary: latest?.summary || '',
      latestSummaryAt: latest?.createdAt || null,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: `刷新摘要失败：${detail}` }, { status: 500 });
  }
}
