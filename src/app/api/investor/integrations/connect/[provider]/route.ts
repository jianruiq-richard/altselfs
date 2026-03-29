import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { buildFeishuAuthUrl, buildGoogleAuthUrl, parseProvider } from '@/lib/integrations';

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

  const state = randomUUID();
  const origin = req.nextUrl.origin;
  const authUrl = provider === 'gmail' ? buildGoogleAuthUrl(origin, state) : buildFeishuAuthUrl(origin, state);

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(`oauth_state_${provider}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  });

  return res;
}
