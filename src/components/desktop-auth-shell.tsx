import Link from 'next/link';
import type { ReactNode } from 'react';
import { Check, MonitorUp, ShieldCheck } from 'lucide-react';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import styles from './desktop-auth-shell.module.css';

type DesktopAuthShellProps = {
  children?: ReactNode;
  description: string;
  step: 1 | 2 | 3;
  title: string;
};

export function DesktopAuthShell({ children, description, step, title }: DesktopAuthShellProps) {
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Minaco home">
        <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandImage} />
        <span>Minaco</span>
      </Link>
      <span>Secure account connection</span>
    </header>
    <section className={styles.layout}>
      <aside className={styles.context}>
        <p className={styles.contextLabel}><MonitorUp size={16} /> Continue on this Mac</p>
        <h1>Back to your<br />workspace.</h1>
        <p>Your Credits, subscription, and connected Agents stay with your Minaco account. Provider credentials remain isolated to the Agent you authorize.</p>
        <ol className={styles.steps}>
          <AuthStep active={step === 1} complete={step > 1} index="1" label="Open secure sign-in" />
          <AuthStep active={step === 2} complete={step > 2} index="2" label="Connect your account" />
          <AuthStep active={step === 3} complete={false} index="3" label="Return to Minaco" />
        </ol>
        <p className={styles.security}><ShieldCheck size={16} /> This page never receives credentials from your other Agent accounts.</p>
      </aside>
      <section className={styles.authPanel}>
        <div className={styles.authHeading}>
          <p>Minaco account</p>
          <h2>{title}</h2>
          <span>{description}</span>
        </div>
        {children}
      </section>
    </section>
  </main>;
}

export function InvalidDesktopRequest() {
  return <DesktopAuthShell step={1} title="Start again from Minaco" description="This secure sign-in request has expired or is invalid.">
    <div className={styles.recovery}>
      <p>Return to the desktop app and choose “Connect Minaco account” to create a fresh request.</p>
      <a href="minaco://auth/complete">Open Minaco</a>
    </div>
  </DesktopAuthShell>;
}

function AuthStep({ active, complete, index, label }: { active: boolean; complete: boolean; index: string; label: string }) {
  return <li className={active ? styles.stepActive : complete ? styles.stepComplete : ''}>
    <span>{complete ? <Check size={15} /> : index}</span>
    <strong>{label}</strong>
  </li>;
}
