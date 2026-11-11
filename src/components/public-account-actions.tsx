'use client';

import { useUser, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import styles from './public-account-actions.module.css';

export function PublicAccountActions({ signUpClassName }: { signUpClassName: string }) {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) return <div className={styles.loading} aria-label="Loading account" aria-busy="true" />;
  if (isSignedIn) return <div className={styles.actions}>
    <Link className={styles.accountLink} href="/account">My account</Link>
    <UserButton />
  </div>;
  return <div className={styles.actions}>
    <Link href="/sign-in?redirect_url=/account">Log in</Link>
    <Link className={signUpClassName} href="/sign-up">Create account</Link>
  </div>;
}
