"use client";
import { useEffect, useState } from 'react';
export function AuthCallbackStatus() {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setWaiting(true), 12000); return () => window.clearTimeout(timer); }, []);
  return <p role="status" aria-live="polite" style={{ color: '#aaa69e', fontSize: 14 }}>{waiting ? 'Still waiting for the sign-in provider. If this page stays here, return to the previous sign-in page and try again.' : 'Completing your account connection…'}</p>;
}
