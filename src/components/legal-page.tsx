import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import { productBrand } from '@/lib/brand';
import styles from './legal-page.module.css';

type LegalPageProps = {
  children: ReactNode;
  description: string;
  documentTitle: string;
  eyebrow: string;
  lastUpdated: string;
  relatedHref: string;
  relatedLabel: string;
  title: string;
  toc: ReadonlyArray<{ href: string; label: string }>;
};

export function LegalPage({
  children,
  description,
  documentTitle,
  eyebrow,
  lastUpdated,
  relatedHref,
  relatedLabel,
  title,
  toc,
}: LegalPageProps) {
  return (
    <main className={styles.legalPage}>
      <nav className={styles.nav}>
        <div className={`${styles.shell} ${styles.navInner}`}>
          <Link className={styles.brand} href="/" aria-label={`${productBrand.name} home`}>
            <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandMarkImage} />
            <span className={styles.brandName}>{productBrand.name}</span>
          </Link>

          <div className={styles.navActions}>
            <Link className={styles.button} href="/">
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
              Home
            </Link>
            <Link className={styles.button} href={relatedHref}>
              {relatedLabel}
            </Link>
          </div>
        </div>
      </nav>

      <header className={`${styles.shell} ${styles.hero}`}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.intro}>{description}</p>
      </header>

      <div className={`${styles.shell} ${styles.layout}`}>
        <aside className={styles.toc} aria-label="Table of contents">
          {toc.map((item) => (
            <a href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </aside>

        <article className={styles.document}>
          <div className={styles.meta}>
            <strong>{documentTitle}</strong>
            <span>Last updated: {lastUpdated}</span>
            <span>Applies to: {productBrand.domain}, the {productBrand.name} web application, APIs, integrations, and related services.</span>
          </div>
          {children}
        </article>
      </div>

      <footer className={styles.footer}>
        <div className={`${styles.shell} ${styles.footerInner}`}>
          <span>{productBrand.name}</span>
          <div className={styles.footerLinks}>
            <Link href="/">Home</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
