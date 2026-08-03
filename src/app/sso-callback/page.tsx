import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SsoCallbackPage() {
  return (
    <AuthenticateWithRedirectCallback
      signInFallbackRedirectUrl="/investor/chat/100"
      signUpFallbackRedirectUrl="/dashboard/setup?role=investor"
      signInUrl="/sign-in?method=email"
      signUpUrl="/sign-up?method=email"
    />
  );
}
