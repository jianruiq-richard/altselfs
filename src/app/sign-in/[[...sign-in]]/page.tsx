import { authDestination, authHref, type AuthSearchParams } from '@/lib/auth-destination';
import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { headers } from "next/headers";
import { AstromarAuthShell } from "@/components/astromar-auth-shell";
import { EmbeddedBrowserAuthGuard } from "@/components/embedded-browser-auth-guard";
import { PhonePasswordAuthForm } from "@/components/phone-code-auth-form";
import { productBrand } from "@/lib/brand";
import { clerkAuthAppearance } from "@/lib/clerk-auth-appearance";
import { isOauthBlockedEmbeddedBrowser } from "@/lib/oauth-browser";

const DEFAULT_AUTH_REDIRECT = "/account";

export const metadata: Metadata = {
  title: `Sign in | ${productBrand.name}`,
  description: `Sign in to ${productBrand.name}, your account for Minaco Desktop.`,
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
  const redirectTarget = authDestination(params.redirect_url || params.redirectUrl || params.next, DEFAULT_AUTH_REDIRECT);
  const emailHref = authHref('/sign-in', redirectTarget, 'email');
  const phoneHref = authHref('/sign-in', redirectTarget, 'phone');
  const headersList = await headers();
  const fallbackUrl = buildFallbackUrl(authHref('/sign-in', redirectTarget, method), headersList);
  const isEmbeddedBrowser = isOauthBlockedEmbeddedBrowser(headersList.get("user-agent"));

  return (
    <AstromarAuthShell
      alternateHref={authHref('/sign-up', redirectTarget, method)}
      emailHref={emailHref}
      method={method}
      mode="sign-in"
      phoneHref={phoneHref}
    >
      {method === "phone" ? (
        <PhonePasswordAuthForm mode="sign-in" redirectUrl={redirectTarget} />
      ) : (
        <EmbeddedBrowserAuthGuard
          fallbackUrl={fallbackUrl}
          initiallyBlocked={isEmbeddedBrowser}
          mode="sign-in"
        >
          <SignIn
            forceRedirectUrl={redirectTarget}
            fallbackRedirectUrl={redirectTarget}
            signUpUrl={authHref('/sign-up', redirectTarget, 'email')}
            appearance={clerkAuthAppearance}
          />
        </EmbeddedBrowserAuthGuard>
      )}
    </AstromarAuthShell>
  );
}
