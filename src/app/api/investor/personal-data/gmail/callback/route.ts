import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { exchangeGoogleReadonlyCode, fetchGmailProfile } from '@/lib/integrations';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

function redirectWithResult(req: NextRequest, status: string, detail?: string) {
  const url = new URL('/investor/info-ops', req.url);
  url.searchParams.set('integrationProvider', 'gmail');
  url.searchParams.set('integrationStatus', status);
  if (detail) url.searchParams.set('integrationDetail', detail);
  return NextResponse.redirect(url);
}

function friendlyError(detail: string) {
  const normalized = detail.toLowerCase();
  if (normalized.includes('redirect_uri_mismatch')) return 'Gmail 回调地址不匹配，请检查 Google OAuth redirect URI。';
  if (normalized.includes('invalid_grant')) return 'Gmail 授权码无效或已过期，请重新绑定。';
  if (normalized.includes('credential vault')) return '后端密钥保险箱未配置，请先配置 ECS secret。';
  if (normalized.includes('ops_agent_token')) return '后端 internal API 授权未配置。';
  if (
    normalized.includes('und_err_connect_timeout') ||
    normalized.includes('connect timeout') ||
    normalized.includes('fetch failed')
  ) {
    return 'Gmail 授权成功，但连接后端保存授权信息超时，请稍后重试或联系管理员检查 personal-agent-server 网络。';
  }
  return 'Gmail 绑定失败，请稍后重试或联系管理员。';
}

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.redirect(new URL('/sign-in', req.url));

  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const stateCookie = req.cookies.get('oauth_state_personal_gmail')?.value;

  if (error) return redirectWithResult(req, 'error', `授权失败：${error}`);
  if (!state || !stateCookie || state !== stateCookie) return redirectWithResult(req, 'error', '授权状态校验失败，请重试');
  if (!code) return redirectWithResult(req, 'error', '缺少授权码');

  try {
    const token = await exchangeGoogleReadonlyCode(req.nextUrl.origin, code);
    const profile = await fetchGmailProfile(token.access_token);
    await personalAgentInternalFetch('/internal/personal-data/oauth-connection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'gmail',
        investorId: investor.id,
        userId: investor.email || investor.id,
        accountEmail: profile.emailAddress,
        accountName: profile.emailAddress,
        token: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          tokenType: token.token_type,
          scope: token.scope,
          expiresIn: token.expires_in,
        },
        profile,
      }),
    });
    const response = redirectWithResult(req, 'connected');
    response.cookies.delete('oauth_state_personal_gmail');
    return response;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[personal-data:gmail] callback failed:', err);
    return redirectWithResult(req, 'error', friendlyError(detail));
  }
}
