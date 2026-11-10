import { SignUp } from '@clerk/nextjs';
import { MinacoAuthFrame } from '@/components/minaco-auth-frame';
import { clerkAuthAppearance } from '@/lib/clerk-auth-appearance';
import { authDestination, authHref, type AuthSearchParams } from '@/lib/auth-destination';
export default async function CompleteOAuthSignUpPage({ searchParams }: { searchParams: Promise<AuthSearchParams> }) {
  const target = authDestination((await searchParams).redirect_url);
  return <MinacoAuthFrame title="One last step." description="Complete the details required to finish creating your Minaco account.">
    <SignUp routing="hash" signInUrl={authHref('/sign-in', target, 'email')} forceRedirectUrl={target} appearance={clerkAuthAppearance} />
  </MinacoAuthFrame>;
}
