import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { MinacoAuthFrame } from '@/components/minaco-auth-frame';
import styles from '@/components/minaco-auth-frame.module.css';
export const metadata: Metadata = { title: 'Get started | Minaco Desktop', robots: { index: false, follow: false } };
export default async function GetStarted() {
  if (!(await auth()).userId) redirect('/sign-up?redirect_url=%2Fget-started');
  return <MinacoAuthFrame title="Your account is ready." description="Bring your next project into Minaco Desktop.">
    <a className={styles.primary} href="/api/download">Download for Mac ↓</a>
    <p className={styles.note}>For Mac with Apple silicon. On another device? Visit minaco.ai on your Mac to install.</p>
    <ol className={styles.steps}>
      <li><div><strong>Install Minaco Desktop</strong><p>Open the downloaded file and drag Minaco into Applications.</p></div></li>
      <li><div><strong>Connect your account</strong><p>Open Minaco and choose “Connect Minaco account”. Use the account you just created.</p></div></li>
      <li><div><strong>Start with something on your list</strong><p>Create a workspace, pick an agent, and give it your first task.</p></div></li>
    </ol>
    <a className={styles.secondary} href="minaco://auth/complete">Already installed? Open Minaco Desktop</a>
    <details className={styles.recovery}><summary>The app didn’t open</summary><p>Open Minaco from your Applications folder. If it isn’t there, download and install it first.</p></details>
    <p className={styles.switch}><Link href="/account">Manage your account, plan, and credits</Link></p>
  </MinacoAuthFrame>;
}
