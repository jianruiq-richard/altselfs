import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';
import { AuthCallbackStatus } from '@/components/auth-callback-status';
import { MinacoAuthFrame } from '@/components/minaco-auth-frame';
import { authDestination, authHref, type AuthSearchParams } from '@/lib/auth-destination';
export default async function SsoCallbackPage({ searchParams }: { searchParams: Promise<AuthSearchParams> }) {
  const target = authDestination((await searchParams).redirect_url);
  return <MinacoAuthFrame title="Finishing your sign-in." description="Keep this page open. We’ll take you to the next step automatically.">
    <AuthCallbackStatus />
    <AuthenticateWithRedirectCallback signInForceRedirectUrl={target} signUpForceRedirectUrl={target} signInUrl={authHref('/sign-in', target, 'email')} signUpUrl={authHref('/sign-up', target, 'email')} continueSignUpUrl={authHref('/auth/complete', target)} />
  </MinacoAuthFrame>;
}
