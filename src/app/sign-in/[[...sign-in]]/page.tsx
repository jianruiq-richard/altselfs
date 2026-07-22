import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { headers } from "next/headers";
import { AstromarAuthShell } from "@/components/astromar-auth-shell";
import { EmbeddedBrowserAuthGuard } from "@/components/embedded-browser-auth-guard";
import { PhonePasswordAuthForm } from "@/components/phone-code-auth-form";
import { clerkAuthAppearance } from "@/lib/clerk-auth-appearance";
import { isOauthBlockedEmbeddedBrowser } from "@/lib/oauth-browser";

export const metadata: Metadata = {
  title: "Sign in | Astromar",
  description: "Sign in to Astromar, your AI cofounder.",
};

function buildFallbackUrl(path: string, headersList: Headers): string {
  const protocol = headersList.get("x-forwarded-proto") ?? "https";
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "altselfs.com";

  return `${protocol}://${host}${path}`;
}

function normalizeRedirectPath(value: unknown): string {
  if (typeof value !== "string") return "/dashboard";
  const path = value.trim();
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/dashboard";
  if (path.startsWith("/sign-in") || path.startsWith("/sign-up")) return "/dashboard";
  return path;
}

function buildMethodHref(method: "phone" | "email", redirectTarget: string) {
  const params = new URLSearchParams({ method });
  if (redirectTarget !== "/dashboard") params.set("redirect_url", redirectTarget);
  return `/sign-in?${params.toString()}`;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ method?: string; redirect_url?: string; redirectUrl?: string; next?: string }>;
}) {
  const params = await searchParams;
  const method = params.method === "phone" ? "phone" : "email";
  const redirectTarget = normalizeRedirectPath(params.redirect_url || params.redirectUrl || params.next);
  const emailHref = buildMethodHref("email", redirectTarget);
  const phoneHref = buildMethodHref("phone", redirectTarget);
  const headersList = await headers();
  const fallbackUrl = buildFallbackUrl(buildMethodHref(method, redirectTarget), headersList);
  const isEmbeddedBrowser = isOauthBlockedEmbeddedBrowser(headersList.get("user-agent"));

  return (
    <AstromarAuthShell
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
            signUpUrl="/sign-up?method=email"
            appearance={clerkAuthAppearance}
          />
        </EmbeddedBrowserAuthGuard>
      )}
    </AstromarAuthShell>
  );
}
