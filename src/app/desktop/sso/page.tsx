import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';
import { desktopRegistrationRequest } from '@/lib/desktop-registration';
import { DesktopAuthShell, InvalidDesktopRequest } from '@/components/desktop-auth-shell';

export default async function DesktopSso({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const request = desktopRegistrationRequest((await searchParams).request);
  if (!request) return <InvalidDesktopRequest />;
  const query = new URLSearchParams({ request }).toString();
  return <DesktopAuthShell step={2} title="Finishing your sign-in." description="Keep this page open. Next, you’ll confirm which account to connect to Minaco Desktop.">
    <AuthenticateWithRedirectCallback
      signInForceRedirectUrl={`/desktop/finish?${query}`}
      signUpForceRedirectUrl={`/desktop/finish?${query}`}
      signInUrl={`/desktop/register?${query}&mode=sign-in`}
      signUpUrl={`/desktop/register?${query}`}
      continueSignUpUrl={`/desktop/complete?${query}`}
    />
  </DesktopAuthShell>;
}
