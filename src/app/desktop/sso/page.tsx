import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';
import { desktopRegistrationRequest } from '@/lib/desktop-registration';

export default async function DesktopSso({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const request = desktopRegistrationRequest((await searchParams).request);
  if (!request) return <p>Return to Minaco Desktop and start sign-in again.</p>;
  const query = new URLSearchParams({ request }).toString();
  return <AuthenticateWithRedirectCallback
    signInForceRedirectUrl={`/desktop/finish?${query}`}
    signUpForceRedirectUrl={`/desktop/finish?${query}`}
    signInUrl={`/desktop/register?${query}&mode=sign-in`}
    signUpUrl={`/desktop/register?${query}`}
    continueSignUpUrl={`/desktop/complete?${query}`}
  />;
}
