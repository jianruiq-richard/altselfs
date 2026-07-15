import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { buildMetaPersonalAuthUrl } from '@/lib/integrations';

function redirectWithResult(req: NextRequest, status: string, detail?: string) {
  const url = new URL('/investor/info-ops', req.url);
  url.searchParams.set('integrationProvider', 'meta');
  url.searchParams.set('integrationStatus', status);
  if (detail) url.searchParams.set('integrationDetail', detail);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.redirect(new URL('/sign-in', req.url));

  try {
    const state = randomUUID();
    const authUrl = buildMetaPersonalAuthUrl(req.nextUrl.origin, state);
    const res = NextResponse.redirect(authUrl);
    res.cookies.set('oauth_state_personal_meta', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    });
    return res;
  } catch (err) {
    console.error('[personal-data:meta] connect failed:', err);
    return redirectWithResult(req, 'error', 'Meta OAuth 环境变量未配置，请先配置 META_APP_ID / META_APP_SECRET。');
  }
}
