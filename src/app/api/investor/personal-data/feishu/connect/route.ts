import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { buildFeishuPersonalAuthUrl } from '@/lib/integrations';

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.redirect(new URL('/sign-in', req.url));

  const state = randomUUID();
  const authUrl = buildFeishuPersonalAuthUrl(req.nextUrl.origin, state);
  const res = NextResponse.redirect(authUrl);
  res.cookies.set('oauth_state_personal_feishu', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  });
  return res;
}
