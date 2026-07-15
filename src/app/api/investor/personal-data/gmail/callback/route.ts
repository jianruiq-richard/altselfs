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
  if (normalized.includes('redirect_uri_mismatch')) return 'Gmail connection failed. Check the Google OAuth redirect URI.';
  if (normalized.includes('invalid_grant')) return 'Gmail authorization expired. Reconnect Gmail.';
  if (normalized.includes('credential vault')) return 'Credential vault is unavailable. Check the ECS secret configuration.';
  if (normalized.includes('ops_agent_token')) return 'Internal API authorization is missing.';
  if (
    normalized.includes('und_err_connect_timeout') ||
    normalized.includes('connect timeout') ||
    normalized.includes('fetch failed')
  ) {
    return 'Gmail connected, but saving the account to personal-agent-server timed out.';
  }
  return 'Gmail connection failed. Please try again.';
}

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.redirect(new URL('/sign-in', req.url));

  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const stateCookie = req.cookies.get('oauth_state_personal_gmail')?.value;

  if (error) return redirectWithResult(req, 'error', `Authorization failed: ${error}`);
  if (!state || !stateCookie || state !== stateCookie) return redirectWithResult(req, 'error', 'OAuth state validation failed. Please reconnect.');
  if (!code) return redirectWithResult(req, 'error', 'Missing authorization code.');

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
