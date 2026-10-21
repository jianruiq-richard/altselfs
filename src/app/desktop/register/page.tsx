import { auth } from '@clerk/nextjs/server';
import { SignIn } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { EmailPasswordSignUpForm } from '@/components/email-password-sign-up-form';
import { PhonePasswordAuthForm } from '@/components/phone-code-auth-form';
import { desktopRegistrationRequest } from '@/lib/desktop-registration';
import { clerkAuthAppearance } from '@/lib/clerk-auth-appearance';

export default async function DesktopRegister({ searchParams }: { searchParams: Promise<{ request?: string; method?: string; mode?: string }> }) {
  const params = await searchParams;
  const request = desktopRegistrationRequest(params.request);
  if (!request) return <main className="p-12">This desktop sign-in link is invalid. Return to Minaco Desktop and try again.</main>;
  const query = new URLSearchParams({ request }).toString();
  const destination = `/desktop/finish?${query}`;
  if ((await auth()).userId) redirect(destination);
  const signIn = params.mode === 'sign-in';
  const mode = signIn ? 'sign-in' : 'sign-up';
  const signInUrl = `/desktop/register?${query}&mode=sign-in`;
  const signUpUrl = `/desktop/register?${query}`;
  return <main className="grid min-h-svh place-items-center bg-[#100f0b] px-5 py-10 text-[#f5f0e5]">
    <section className="w-full max-w-[460px] rounded-3xl border border-[#514125] bg-[#1b1711] p-8">
      <p className="mb-6 font-serif text-3xl text-[#f2c36b]">✦ minaco</p>
      <h1 className="text-2xl font-semibold">{signIn ? 'Sign in to Minaco' : 'Create your Minaco account'}</h1>
      <p className="my-4 text-sm text-[#b9ad96]">One account for Minaco web and Desktop. We’ll return you to the desktop app when you’re ready.</p>
      <nav className="my-5 flex gap-5 text-sm text-[#f2c36b]">
        <Link href={`/desktop/register?${query}&mode=${mode}`}>Email / Google</Link>
        <Link href={`/desktop/register?${query}&mode=${mode}&method=phone`}>Phone</Link>
      </nav>
      {params.method === 'phone' ? <PhonePasswordAuthForm mode={mode} redirectUrl={destination} /> : signIn ?
        <SignIn routing="hash" forceRedirectUrl={destination} fallbackRedirectUrl={destination} signUpUrl={signUpUrl} appearance={clerkAuthAppearance} /> :
        <EmailPasswordSignUpForm redirectUrl={destination} oauthCallbackUrl={`/desktop/sso?${query}`} signInUrl={signInUrl} />}
      <p className="mt-6 text-sm"><Link className="text-[#f2c36b]" href={signIn ? signUpUrl : signInUrl}>{signIn ? 'Create an account' : 'Already have an account? Sign in'}</Link></p>
    </section>
  </main>;
}
