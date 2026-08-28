import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import { blogCtaHref } from '@/lib/blog';
import { productBrand } from '@/lib/brand';
import styles from './blog.module.css';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <a href="#blog-content" className={styles.skipLink}>Skip to content</a>
      <header className={styles.header}>
        <nav className={styles.navigation} aria-label="Main navigation">
          <Link className={styles.brand} href="/" aria-label={`${productBrand.name} home`}>
            <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandImage} />
            <span>{productBrand.name}</span>
          </Link>
          <div className={styles.navLinks}>
            <Link href="/blog" aria-current="location">Blog</Link>
            <Link href="/pricing">Pricing</Link>
            <Link
              href={blogCtaHref}
              className={styles.button}
              data-analytics-cta="blog_nav_get_started"
              data-analytics-location="blog_nav"
            >
              Try Minaco <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </nav>
      </header>
      <main id="blog-content" className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <Link className={styles.footerBrand} href="/">{productBrand.name}</Link>
        <p>One subscription. More insight.</p>
        <nav aria-label="Footer navigation">
          <Link href="/blog">Blog</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
