import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { desktopRegistrationRequest, desktopRegistrationReturn } from '@/lib/desktop-registration';

export async function GET(req: Request) {
  const request = desktopRegistrationRequest(new URL(req.url).searchParams.get('request'));
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
  if (!request) return new Response('Invalid desktop sign-in request. Return to Minaco Desktop and try again.', { status: 400, headers });
  const user = await getInvestorOrNull();
  if (!user) return NextResponse.redirect(new URL(`/desktop/register?${new URLSearchParams({ request, mode: 'sign-in' })}`, req.url), { headers });
  // Reuse the existing idempotent account/credits initialization. No Desktop welcome grant.
  try {
    await personalAgentInternalFetch(`/internal/billing/capacity?${new URLSearchParams({ investorId: user.id })}`);
  } catch {
    return new Response('Your account was created, but setup is still finishing. Refresh this page to retry and return to Minaco Desktop.', { status: 503, headers });
  }
  return NextResponse.redirect(desktopRegistrationReturn(request), { headers });
}
