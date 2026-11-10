import { desktopAuthErrorPage } from '@/lib/desktop-auth-error';
import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { desktopRegistrationRequest, desktopRegistrationReturn } from '@/lib/desktop-registration';

export async function GET(req: Request) {
  const request = desktopRegistrationRequest(new URL(req.url).searchParams.get('request'));
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
  if (!request) return new Response(desktopAuthErrorPage(false), { status: 400, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  const user = await getInvestorOrNull();
  if (!user) return NextResponse.redirect(new URL(`/desktop/register?${new URLSearchParams({ request, mode: 'sign-in' })}`, req.url), { headers });
  // Reuse the existing idempotent account/credits initialization. No Desktop welcome grant.
  try {
    await personalAgentInternalFetch(`/internal/billing/capacity?${new URLSearchParams({ investorId: user.id })}`);
  } catch {
    return new Response(desktopAuthErrorPage(true, request), { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '5' } });
  }
  return NextResponse.redirect(desktopRegistrationReturn(request), { headers });
}
