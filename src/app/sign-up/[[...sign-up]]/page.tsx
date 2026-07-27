import type { Metadata } from "next";
import { headers } from "next/headers";
import { AstromarAuthShell } from "@/components/astromar-auth-shell";
import { EmailPasswordSignUpForm } from "@/components/email-password-sign-up-form";
import { EmbeddedBrowserAuthGuard } from "@/components/embedded-browser-auth-guard";
import { PhonePasswordAuthForm } from "@/components/phone-code-auth-form";
import { isOauthBlockedEmbeddedBrowser } from "@/lib/oauth-browser";

export const metadata: Metadata = {
  title: "Create account | Astromar",
  description: "Create your Astromar AI cofounder account.",
};

function buildFallbackUrl(path: string, headersList: Headers): string {
  const protocol = headersList.get("x-forwarded-proto") ?? "https";
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "altselfs.com";

  return `${protocol}://${host}${path}`;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ method?: string }>;
}) {
  const params = await searchParams;
  const method = params.method === "phone" ? "phone" : "email";
  const headersList = await headers();
  const fallbackUrl = buildFallbackUrl(`/sign-up?method=${method}`, headersList);
  const isEmbeddedBrowser = isOauthBlockedEmbeddedBrowser(headersList.get("user-agent"));

  return (
    <AstromarAuthShell
      emailHref="/sign-up?method=email"
      method={method}
      mode="sign-up"
      phoneHref="/sign-up?method=phone"
    >
      {method === "phone" ? (
        <PhonePasswordAuthForm mode="sign-up" />
      ) : (
        <EmbeddedBrowserAuthGuard
          fallbackUrl={fallbackUrl}
          initiallyBlocked={isEmbeddedBrowser}
          mode="sign-up"
        >
          <EmailPasswordSignUpForm />
        </EmbeddedBrowserAuthGuard>
      )}
    </AstromarAuthShell>
  );
}
