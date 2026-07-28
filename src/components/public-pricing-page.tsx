import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { BillingPlanGrid } from '@/components/billing-plan-grid';
import styles from './astromar-landing-page.module.css';

const signInHref = '/sign-in?method=email&redirect_url=/dashboard';

function classes(...names: string[]) {
  return names.map((name) => styles[name]).filter(Boolean).join(' ');
}

export function PublicPricingPage() {
  return (
    <main className={styles.landing}>
      <nav className={styles.nav}>
        <div className={classes('container', 'navInner')}>
          <Link className={styles.brand} href="/" aria-label="Astromar home">
            <span className={styles.brandMark} aria-hidden="true" />
            <span className={styles.brandName}>Astromar</span>
            <span className={styles.brandTagline}>Think with you. Act for you.</span>
          </Link>

          <div className={styles.navLinks} aria-label="Primary navigation">
            <Link href="/pricing">Pricing</Link>
            <Link href="/#cases">Use cases</Link>
            <Link href="/#conversation">How it thinks</Link>
          </div>

          <div className={styles.authActions} aria-label="Account actions">
            <Link className={styles.button} href="/sign-in?method=email">
              Sign in
            </Link>
            <Link className={classes('button', 'buttonPrimary')} href={signInHref}>
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <section className={classes('container', 'section')} id="pricing">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Pricing</p>
            <h1>Usage-based plans for agent work.</h1>
          </div>
          <div className={styles.pricingIntro}>
            <p>
              Credits measure actual agent work and never expire. Annual billing keeps the same workspace limits,
              grants the full year of Credits up front, and gives 20% off the equivalent monthly subscription.
            </p>
            <Link className={classes('button', 'buttonPrimary')} href={signInHref}>
              Get Started
              <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
            </Link>
          </div>
        </div>
        <BillingPlanGrid getStartedHref={signInHref} showIntro={false} variant="public" />
      </section>
    </main>
  );
}
