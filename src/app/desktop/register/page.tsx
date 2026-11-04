import { auth } from '@clerk/nextjs/server';
import { SignIn } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { EmailPasswordSignUpForm } from '@/components/email-password-sign-up-form';
import { PhonePasswordAuthForm } from '@/components/phone-code-auth-form';
import { desktopRegistrationRequest } from '@/lib/desktop-registration';
import { clerkAuthAppearance } from '@/lib/clerk-auth-appearance';
import { DesktopAuthShell, InvalidDesktopRequest } from '@/components/desktop-auth-shell';

export default async function DesktopRegister({ searchParams }: { searchParams: Promise<{ request?: string; method?: string; mode?: string }> }) {
  const params = await searchParams;
  const request = desktopRegistrationRequest(params.request);
  if (!request) return <InvalidDesktopRequest />;
  const query = new URLSearchParams({ request }).toString();
  const destination = `/desktop/finish?${query}`;
  if ((await auth()).userId) redirect(destination);
  const signIn = params.mode === 'sign-in';
  const mode = signIn ? 'sign-in' : 'sign-up';
  const signInUrl = `/desktop/register?${query}&mode=sign-in`;
  const signUpUrl = `/desktop/register?${query}`;
  return <DesktopAuthShell step={2} title={signIn ? 'Welcome back' : 'Create your account'} description="Use the same account for Desktop, Credits, and the Minaco Web Agent.">
    <div>
      <nav className="my-5 flex gap-5 text-sm text-[#f2c36b]">
        <Link href={`/desktop/register?${query}&mode=${mode}`}>Email / Google</Link>
        <Link href={`/desktop/register?${query}&mode=${mode}&method=phone`}>Phone</Link>
      </nav>
      {params.method === 'phone' ? <PhonePasswordAuthForm mode={mode} redirectUrl={destination} /> : signIn ?
        <SignIn routing="hash" forceRedirectUrl={destination} fallbackRedirectUrl={destination} signUpUrl={signUpUrl} appearance={clerkAuthAppearance} /> :
        <EmailPasswordSignUpForm redirectUrl={destination} oauthCallbackUrl={`/desktop/sso?${query}`} signInUrl={signInUrl} />}
      <p className="mt-6 text-sm"><Link className="text-[#f2c36b]" href={signIn ? signUpUrl : signInUrl}>{signIn ? 'Create an account' : 'Already have an account? Sign in'}</Link></p>
    </div>
  </DesktopAuthShell>;
}
