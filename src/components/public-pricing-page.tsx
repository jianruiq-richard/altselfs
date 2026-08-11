import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { BillingPlanGrid } from '@/components/billing-plan-grid';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import { productBrand } from '@/lib/brand';
import styles from './astromar-landing-page.module.css';

const signInHref = '/sign-in?method=email&redirect_url=/investor/chat/100';

function classes(...names: string[]) {
  return names.map((name) => styles[name]).filter(Boolean).join(' ');
}

export function PublicPricingPage() {
  return (
    <main className={styles.landing}>
      <nav className={styles.nav}>
        <div className={classes('container', 'navInner')}>
          <Link className={styles.brand} href="/" aria-label={`${productBrand.name} home`}>
            <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandMarkImage} />
            <span className={styles.brandName}>{productBrand.name}</span>
            <span className={styles.brandTagline}>{productBrand.tagline}</span>
          </Link>

          <div className={styles.navLinks} aria-label="Primary navigation">
            <Link href="/pricing">Pricing</Link>
            <Link href="/#cases">Use cases</Link>
            <Link href="/#conversation">How it thinks</Link>
          </div>

          <div className={styles.authActions} aria-label="Account actions">
            <Link
              className={styles.button}
              href="/sign-in?method=email"
              data-analytics-cta="nav_sign_in"
              data-analytics-location="pricing_nav"
            >
              Sign in
            </Link>
            <Link
              className={classes('button', 'buttonPrimary')}
              href={signInHref}
              data-analytics-cta="nav_get_started"
              data-analytics-location="pricing_nav"
            >
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
            <Link
              className={classes('button', 'buttonPrimary')}
              href={signInHref}
              data-analytics-cta="pricing_get_started"
              data-analytics-location="pricing_header"
            >
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
