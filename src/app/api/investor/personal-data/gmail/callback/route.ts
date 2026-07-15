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
  if (normalized.includes('redirect_uri_mismatch')) return 'Gmail message, message Google OAuth redirect URI.';
  if (normalized.includes('invalid_grant')) return 'Gmail message, messageReconnect.';
  if (normalized.includes('credential vault')) return 'message, message ECS secret.';
  if (normalized.includes('ops_agent_token')) return 'message internal API message.';
  if (
    normalized.includes('und_err_connect_timeout') ||
    normalized.includes('connect timeout') ||
    normalized.includes('fetch failed')
  ) {
    return 'Gmail message, messageSavemessage, message personal-agent-server message.';
  }
  return 'Gmail connection failed, message.';
}

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.redirect(new URL('/sign-in', req.url));

  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const stateCookie = req.cookies.get('oauth_state_personal_gmail')?.value;

  if (error) return redirectWithResult(req, 'error', `messagefailed: ${error}`);
  if (!state || !stateCookie || state !== stateCookie) return redirectWithResult(req, 'error', 'messagefailed, message');
  if (!code) return redirectWithResult(req, 'error', 'message');

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
