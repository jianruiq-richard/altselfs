"use client";

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth, useClerk, useUser } from '@clerk/nextjs';
import { desktopCallback } from '@/lib/desktop-callback';
import styles from './desktop-connect.module.css';

export function DesktopConnect({ requestId, registered, apiUrl }: { requestId: string; registered: boolean; apiUrl: string }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [busy, setBusy] = useState<'complete' | 'cancel' | 'switch' | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const query = new URLSearchParams({ request: requestId }).toString();
  const registerUrl = `/desktop/register?${query}`;
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'your Minaco account';

  async function act(action: 'complete' | 'cancel' | 'switch') {
    if (pending.current) return;
    pending.current = true;
    setBusy(action);
    setError('');
    try {
      if (action === 'switch') {
        await signOut({ redirectUrl: `${registerUrl}&mode=sign-in` });
        return;
      }
      const token = action === 'complete' ? await getToken() : null;
      if (action === 'complete' && !token) throw new Error('Sign in to Minaco to continue.');
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/desktop/auth/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ requestId }),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error?.code === 'MINACO_ACCOUNT_REQUIRED' && !registered) {
          location.assign(registerUrl);
          return;
        }
        throw new Error(result.error?.message || 'Unable to connect. Please try again.');
      }
      location.assign(desktopCallback(result.redirectUrl, action === 'cancel'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to connect. Please try again.');
      pending.current = false;
      setBusy(null);
    }
  }

  return <div className={styles.content} aria-busy={busy !== null}>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!isLoaded ? <p role="status">Loading your account…</p> : isSignedIn ? <>
      <div className={styles.account} aria-label="Selected Minaco account">
        <span className={styles.avatar} aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
        <div><strong>{name}</strong><span>{user?.primaryEmailAddress?.emailAddress}</span></div>
      </div>
      <button className={styles.primary} disabled={busy !== null} onClick={() => void act('complete')}>{busy === 'complete' ? 'Connecting…' : 'Connect this Mac'}</button>
      <button className={styles.secondary} disabled={busy !== null} onClick={() => void act('switch')}>{busy === 'switch' ? 'Switching account…' : 'Use another account'}</button>
    </> : <>
      <Link className={styles.primary} href={`${registerUrl}&mode=sign-in`}>Sign in to Minaco</Link>
      <Link className={styles.secondary} href={registerUrl}>Create an account</Link>
    </>}
    <button className={styles.cancel} disabled={busy !== null} onClick={() => void act('cancel')}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel'}</button>
    <p className={styles.note}>Only connect if you started this sign-in from Minaco Desktop on this Mac.</p>
  </div>;
}
