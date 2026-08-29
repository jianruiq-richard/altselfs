import type { ReactNode } from "react";
import Link from "next/link";
import { AuthReportCarousel } from "@/components/auth-report-carousel";
import { MinacoBrandMark } from "@/components/minaco-brand-mark";
import { productBrand } from "@/lib/brand";
import styles from "./astromar-auth.module.css";

type AstromarAuthShellProps = {
  children: ReactNode;
  emailHref: string;
  method: "email" | "phone";
  mode: "sign-in" | "sign-up";
  phoneHref: string;
};

function Brand() {
  return (
    <Link className={styles.brandLockup} href="/" aria-label={`${productBrand.name} home`}>
      <span className={styles.brand}>
        <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandMarkImage} />
        <span>{productBrand.name}</span>
      </span>
      <span className={styles.brandTagline}>{productBrand.tagline}</span>
    </Link>
  );
}

export function AstromarAuthShell({
  children,
  emailHref,
  method,
  mode,
  phoneHref,
}: AstromarAuthShellProps) {
  const isSignIn = mode === "sign-in";

  return (
    <main className={styles.authPage}>
      <header className={styles.topbar}>
        <Brand />
        <div className={styles.topAction}>
          <span>{isSignIn ? `New to ${productBrand.name}?` : "Already have an account?"}</span>
          <Link href={isSignIn ? "/sign-up?method=email" : "/sign-in?method=email"}>
            {isSignIn ? "Create account" : "Sign in"}
          </Link>
        </div>
      </header>

      <div className={styles.layout}>
        <section className={styles.authSide}>
          <div className={styles.authWrap}>
            <p className={`${styles.eyebrow} ${isSignIn ? styles.eyebrowSignIn : ""}`}>
              {isSignIn ? "Welcome back" : "Get started"}
            </p>
            <h1>{isSignIn ? "Continue with your AI cofounder." : "Build your AI cofounder."}</h1>
            <p className={styles.intro}>
              {isSignIn
                ? "Your context, decisions, and active work are ready when you are."
                : "Start with one decision. Bring in more context when you are ready."}
            </p>

            <nav className={styles.modeTabs} aria-label="Authentication method">
              <Link className={method === "email" ? styles.modeTabActive : styles.modeTab} href={emailHref}>
                Email / Google
              </Link>
              <Link className={method === "phone" ? styles.modeTabActive : styles.modeTab} href={phoneHref}>
                Phone / password
              </Link>
            </nav>

            <div className={styles.authContent}>
              {children}
              {isSignIn ? (
                <Link
                  className={styles.createAccountButton}
                  href={`/sign-up?method=${method}`}
                  data-analytics-cta="sign_in_create_account"
                  data-analytics-location="auth_form"
                >
                  Create account
                </Link>
              ) : null}
            </div>
          </div>
        </section>

        <aside className={styles.productSide} aria-label={`${productBrand.name} competitor intelligence report preview`}>
          <AuthReportCarousel />
        </aside>
      </div>
    </main>
  );
}
