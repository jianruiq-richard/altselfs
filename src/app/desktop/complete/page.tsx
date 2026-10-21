import { SignUp } from '@clerk/nextjs';
import { desktopRegistrationRequest } from '@/lib/desktop-registration';

export default async function DesktopComplete({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const request = desktopRegistrationRequest((await searchParams).request);
  if (!request) return <p>Return to Minaco Desktop and start sign-in again.</p>;
  const query = new URLSearchParams({ request }).toString();
  return <main className="grid min-h-svh place-items-center bg-[#100f0b]"><SignUp routing="hash" forceRedirectUrl={`/desktop/finish?${query}`} signInUrl={`/desktop/register?${query}&mode=sign-in`} /></main>;
}
