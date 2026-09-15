import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { AuthCallbackStatus } from "@/components/auth-callback-status";

export default function SsoCallbackPage() {
  return (
    <>
    <AuthCallbackStatus />
    <AuthenticateWithRedirectCallback
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/dashboard/setup?role=investor"
      signInUrl="/sign-in?method=email"
      signUpUrl="/sign-up?method=email"
      continueSignUpUrl="/auth/complete"
    />
    </>
  );
}
