import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SsoCallbackPage() {
  return (
    <AuthenticateWithRedirectCallback
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/dashboard/setup?role=investor"
      signInUrl="/sign-in?method=email"
      signUpUrl="/sign-up?method=email"
    />
  );
}
