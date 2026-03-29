import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import {
  buildFeishuSummary,
  buildGmailSummary,
  exchangeFeishuCode,
  exchangeGoogleCode,
  parseProvider,
  saveIntegrationSnapshot,
} from '@/lib/integrations';

function redirectWithResult(req: NextRequest, provider: string, status: string, detail?: string) {
  const url = new URL('/investor', req.url);
  url.searchParams.set('integrationProvider', provider);
  url.searchParams.set('integrationStatus', status);
  if (detail) {
    url.searchParams.set('integrationDetail', detail);
  }
  return NextResponse.redirect(url);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const investor = await getInvestorOrNull();
  if (!investor) {
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }

  const { provider: rawProvider } = await params;
  const provider = parseProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
  }

  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const stateCookie = req.cookies.get(`oauth_state_${provider}`)?.value;

  if (error) {
    return redirectWithResult(req, provider, 'error', `授权失败：${error}`);
  }
  if (!state || !stateCookie || state !== stateCookie) {
    return redirectWithResult(req, provider, 'error', '授权状态校验失败，请重试');
  }
  if (!code) {
    return redirectWithResult(req, provider, 'error', '缺少授权码');
  }

  try {
    const origin = req.nextUrl.origin;

    if (provider === 'gmail') {
      const token = await exchangeGoogleCode(origin, code);
      const digest = await buildGmailSummary(token.access_token);
      await saveIntegrationSnapshot({
        investorId: investor.id,
        provider,
        accountEmail: digest.accountEmail,
        accountName: digest.accountName,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        scope: token.scope,
        expiresIn: token.expires_in,
        summary: digest.summary,
        raw: digest.raw,
      });
    } else {
      const token = await exchangeFeishuCode(origin, code);
      const digest = await buildFeishuSummary(token.access_token);
      await saveIntegrationSnapshot({
        investorId: investor.id,
        provider,
        accountEmail: digest.accountEmail || undefined,
        accountName: digest.accountName,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        scope: token.scope,
        expiresIn: token.expires_in,
        summary: digest.summary,
        raw: digest.raw,
      });
    }

    const response = redirectWithResult(req, provider, 'connected');
    response.cookies.delete(`oauth_state_${provider}`);
    return response;
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    return redirectWithResult(req, provider, 'error', detail.slice(0, 180));
  }
}
