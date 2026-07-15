import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { exchangeMetaPersonalCode, fetchMetaProfileAndAssets, getMetaPersonalOAuthScope } from '@/lib/integrations';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

function redirectWithResult(req: NextRequest, status: string, detail?: string) {
  const url = new URL('/investor/info-ops', req.url);
  url.searchParams.set('integrationProvider', 'meta');
  url.searchParams.set('integrationStatus', status);
  if (detail) url.searchParams.set('integrationDetail', detail);
  return NextResponse.redirect(url);
}

function friendlyError(detail: string) {
  const normalized = detail.toLowerCase();
  if (normalized.includes('redirect_uri')) return 'Meta 回调地址不匹配，请检查 Facebook Login redirect URI。';
  if (normalized.includes('invalid') && normalized.includes('code')) return 'Meta 授权码无效或已过期，请重新绑定。';
  if (normalized.includes('app_id') || normalized.includes('app secret') || normalized.includes('meta_app')) {
    return 'Meta OAuth 环境变量未配置，请先配置 META_APP_ID / META_APP_SECRET。';
  }
  if (normalized.includes('credential vault')) return '后端密钥保险箱未配置，请先配置 ECS secret。';
  if (
    normalized.includes('und_err_connect_timeout') ||
    normalized.includes('connect timeout') ||
    normalized.includes('fetch failed')
  ) {
    return 'Meta 授权成功，但连接后端保存授权信息超时，请稍后重试或联系管理员检查 personal-agent-server 网络。';
  }
  return 'Meta / Instagram / Facebook 绑定失败，请稍后重试或联系管理员。';
}

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.redirect(new URL('/sign-in', req.url));

  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const errorDescription = req.nextUrl.searchParams.get('error_description');
  const stateCookie = req.cookies.get('oauth_state_personal_meta')?.value;

  if (error) return redirectWithResult(req, 'error', `授权失败：${errorDescription || error}`);
  if (!state || !stateCookie || state !== stateCookie) return redirectWithResult(req, 'error', '授权状态校验失败，请重试');
  if (!code) return redirectWithResult(req, 'error', '缺少授权码');

  try {
    const token = await exchangeMetaPersonalCode(req.nextUrl.origin, code);
    const assets = await fetchMetaProfileAndAssets(token.access_token);
    await personalAgentInternalFetch('/internal/personal-data/oauth-connection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'meta',
        investorId: investor.id,
        userId: investor.email || investor.id,
        accountId: assets.profile.id,
        accountName: assets.profile.name || assets.profile.email || assets.profile.id,
        accountEmail: assets.profile.email,
        token: {
          accessToken: token.access_token,
          tokenType: token.token_type,
          scope: getMetaPersonalOAuthScope(),
          expiresIn: token.expires_in,
        },
        profile: assets.profile,
        pages: assets.pages,
        instagramAccounts: assets.instagramAccounts,
      }),
    });
    const response = redirectWithResult(req, 'connected');
    response.cookies.delete('oauth_state_personal_meta');
    return response;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[personal-data:meta] callback failed:', err);
    return redirectWithResult(req, 'error', friendlyError(detail));
  }
}
