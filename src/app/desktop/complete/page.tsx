import { clerkAuthAppearance } from '@/lib/clerk-auth-appearance';
import { SignUp } from '@clerk/nextjs';
import { desktopRegistrationRequest } from '@/lib/desktop-registration';
import { DesktopAuthShell, InvalidDesktopRequest } from '@/components/desktop-auth-shell';

export default async function DesktopComplete({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const request = desktopRegistrationRequest((await searchParams).request);
  if (!request) return <InvalidDesktopRequest />;
  const query = new URLSearchParams({ request }).toString();
  return <DesktopAuthShell step={2} title="One last step." description="Complete the details required to finish creating your Minaco account.">
    <SignUp appearance={clerkAuthAppearance} routing="hash" forceRedirectUrl={`/desktop/finish?${query}`} signInUrl={`/desktop/register?${query}&mode=sign-in`} />
  </DesktopAuthShell>;
}
