'use client';

import { useState } from 'react';
import { SignIn } from '@clerk/nextjs';
import { useSignIn } from '@clerk/nextjs/legacy';
import { GoogleMark } from './email-password-sign-up-form';
import { clerkAuthAppearance } from '@/lib/clerk-auth-appearance';
import styles from './astromar-auth.module.css';

export function ModalEmailSignIn({ redirectUrl }: { redirectUrl: string }) {
  const { isLoaded, signIn } = useSignIn();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function continueWithGoogle() {
    if (!isLoaded || !signIn || pending) return;
    setPending(true);
    setError('');
    try {
      // The modal is gone after a full OAuth redirect. Complete authentication
      // on an always-mounted route instead of SignIn's internal hash callback.
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sso-callback',
        redirectUrlComplete: redirectUrl,
      });
    } catch {
      setError('Unable to continue with Google. Please try again.');
      setPending(false);
    }
  }

  return <div className={styles.emailForm}>
    <button type="button" className={styles.googleButton} disabled={!isLoaded || pending} onClick={continueWithGoogle}>
      <GoogleMark />{pending ? 'Connecting…' : 'Continue with Google'}
    </button>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    <div className={styles.authDivider}><span>or</span></div>
    <SignIn routing="hash" forceRedirectUrl={redirectUrl} fallbackRedirectUrl={redirectUrl}
      signUpUrl="/sign-up?method=email"
      appearance={{ ...clerkAuthAppearance, elements: {
        ...clerkAuthAppearance.elements,
        socialButtons: { display: 'none' },
        dividerRow: { display: 'none' },
      } }} />
  </div>;
}
