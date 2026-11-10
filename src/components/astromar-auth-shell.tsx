import type { ReactNode } from 'react';
import Link from 'next/link';
import { MinacoAuthFrame } from './minaco-auth-frame';
import styles from './minaco-auth-frame.module.css';

export function AstromarAuthShell({ children, emailHref, phoneHref, method, mode, alternateHref }: { children: ReactNode; emailHref: string; phoneHref: string; method: 'email' | 'phone'; mode: 'sign-in' | 'sign-up'; alternateHref?: string }) {
  const signIn = mode === 'sign-in';
  return <MinacoAuthFrame title={signIn ? 'Sign in to Minaco.' : 'Your agents start here.'} description={signIn ? 'Access your account, plan, and credits. Your projects stay in Minaco Desktop.' : 'Create one account for Minaco Desktop, your agents, and your credits.'}>
    <nav className={styles.methods} aria-label="Sign-in method"><Link href={emailHref} aria-current={method === 'email' ? 'page' : undefined}>Email / Google</Link><Link href={phoneHref} aria-current={method === 'phone' ? 'page' : undefined}>Phone</Link></nav>
    {children}
    <p className={styles.switch}>{signIn ? 'New to Minaco? ' : 'Already have an account? '}<Link href={alternateHref || (signIn ? '/sign-up' : '/sign-in')}>{signIn ? 'Create an account' : 'Sign in'}</Link></p>
  </MinacoAuthFrame>;
}
