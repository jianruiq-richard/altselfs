import type { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './minaco-auth-frame.module.css';

export function MinacoAuthFrame({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" aria-label="Minaco home"><Image src="/brand/minaco/minaco-logo-auth.svg" alt="Minaco" width={144} height={36} priority unoptimized /></Link><span>Desktop</span></header>
    <section className={styles.panel} aria-labelledby="auth-title">
      <h1 id="auth-title">{title}</h1><p className={styles.description}>{description}</p>
      {children}
    </section>
    <footer className={styles.footer}><span>© {new Date().getFullYear()} Minaco</span><nav aria-label="Legal"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></nav></footer>
  </main>;
}
