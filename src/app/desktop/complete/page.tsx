import { SignUp } from '@clerk/nextjs';
import { desktopRegistrationRequest } from '@/lib/desktop-registration';
import { DesktopAuthShell, InvalidDesktopRequest } from '@/components/desktop-auth-shell';

export default async function DesktopComplete({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const request = desktopRegistrationRequest((await searchParams).request);
  if (!request) return <InvalidDesktopRequest />;
  const query = new URLSearchParams({ request }).toString();
  return <DesktopAuthShell step={2} title="Complete your profile" description="One last step, then Minaco will reopen your desktop workspace.">
    <SignUp routing="hash" forceRedirectUrl={`/desktop/finish?${query}`} signInUrl={`/desktop/register?${query}&mode=sign-in`} />
  </DesktopAuthShell>;
}
