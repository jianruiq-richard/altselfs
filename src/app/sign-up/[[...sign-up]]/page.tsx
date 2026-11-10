import { authDestination, authHref, type AuthSearchParams } from '@/lib/auth-destination';
import type { Metadata } from "next";
import { headers } from "next/headers";
import { AstromarAuthShell } from "@/components/astromar-auth-shell";
import { EmailPasswordSignUpForm } from "@/components/email-password-sign-up-form";
import { EmbeddedBrowserAuthGuard } from "@/components/embedded-browser-auth-guard";
import { PhonePasswordAuthForm } from "@/components/phone-code-auth-form";
import { productBrand } from "@/lib/brand";
import { isOauthBlockedEmbeddedBrowser } from "@/lib/oauth-browser";

export const metadata: Metadata = {
  title: `Create account | ${productBrand.name}`,
  description: `Create your ${productBrand.name} Desktop account.`,
};

function buildFallbackUrl(path: string, headersList: Headers): string {
  const protocol = headersList.get("x-forwarded-proto") ?? "https";
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? productBrand.domain;

  return `${protocol}://${host}${path}`;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<AuthSearchParams>;
}) {
  const params = await searchParams;
  const method = params.method === "phone" ? "phone" : "email";
  const redirectTarget = authDestination(params.redirect_url || params.redirectUrl || params.next);
  const headersList = await headers();
  const fallbackUrl = buildFallbackUrl(authHref('/sign-up', redirectTarget, method), headersList);
  const isEmbeddedBrowser = isOauthBlockedEmbeddedBrowser(headersList.get("user-agent"));

  return (
    <AstromarAuthShell
      alternateHref={authHref('/sign-in', redirectTarget, method)}
      emailHref={authHref('/sign-up', redirectTarget, 'email')}
      method={method}
      mode="sign-up"
      phoneHref={authHref('/sign-up', redirectTarget, 'phone')}
    >
      {method === "phone" ? (
        <PhonePasswordAuthForm mode="sign-up" redirectUrl={redirectTarget} />
      ) : (
        <EmbeddedBrowserAuthGuard
          fallbackUrl={fallbackUrl}
          initiallyBlocked={isEmbeddedBrowser}
          mode="sign-up"
        >
          <EmailPasswordSignUpForm redirectUrl={redirectTarget} oauthCallbackUrl={authHref('/sso-callback', redirectTarget)} signInUrl={authHref('/sign-in', redirectTarget, 'email')} />
        </EmbeddedBrowserAuthGuard>
      )}
    </AstromarAuthShell>
  );
}
