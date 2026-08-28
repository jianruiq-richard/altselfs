import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Mail, MessagesSquare } from 'lucide-react';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import { productBrand } from '@/lib/brand';
import styles from './contact.module.css';

const title = `Contact | ${productBrand.name}`;
const description = `Get in touch with ${productBrand.name} at ${productBrand.supportEmail} or join our Discord community for product questions, account help, and feedback.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/contact' },
  openGraph: {
    type: 'website',
    title,
    description,
    url: '/contact',
    siteName: productBrand.name,
  },
};

export default function ContactPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <nav className={styles.navigation} aria-label="Main navigation">
          <Link href="/" className={styles.brand} aria-label={`${productBrand.name} home`}>
            <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandImage} />
            <span>{productBrand.name}</span>
          </Link>
          <Link href="/" className={styles.backLink}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to home
          </Link>
        </nav>
      </header>

      <main className={styles.main}>
        <p className={styles.eyebrow}>Get in touch</p>
        <h1>Contact us</h1>
        <p className={styles.description}>
          Have a question about {productBrand.name}, need help with your account, or want to
          share feedback? Reach us by email or join our Discord community.
        </p>
        <div className={styles.contactCard}>
          <p className={styles.contactLabel}><Mail size={18} aria-hidden="true" /> Email</p>
          <a href={`mailto:${productBrand.supportEmail}`} className={styles.contactLink}>
            {productBrand.supportEmail}
          </a>
        </div>
        <div className={styles.contactCard}>
          <p className={styles.contactLabel}><MessagesSquare size={18} aria-hidden="true" /> Discord community</p>
          <a
            href="https://discord.gg/Nt5NFdJRfN"
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.contactLink} ${styles.discordLink}`}
            aria-label="Join our Discord community (opens in a new tab)"
          >
            <span>Join our Discord</span>
            <ArrowUpRight size={22} aria-hidden="true" />
          </a>
        </div>
      </main>

      <footer className={styles.footer}>
        <span>{productBrand.name}</span>
        <nav aria-label="Footer navigation">
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
