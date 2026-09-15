import { SignUp } from '@clerk/nextjs';
import { clerkAuthAppearance } from '@/lib/clerk-auth-appearance';

export default function CompleteOAuthSignUpPage() {
  return <main className="flex min-h-screen items-center justify-center bg-[#111213] p-6">
    <SignUp routing="path" path="/auth/complete" signInUrl="/sign-in?method=email"
      forceRedirectUrl="/dashboard/setup?role=investor" appearance={clerkAuthAppearance} />
  </main>;
}
