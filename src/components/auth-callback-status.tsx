'use client';

import { useEffect, useState } from 'react';
import { MinacoBrandMark } from './minaco-brand-mark';

export function AuthCallbackStatus() {
  const [takingLonger, setTakingLonger] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setTakingLonger(true), 12000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#090a0a] px-6 text-[#fffaf0]">
      <section className="w-full max-w-sm text-center" aria-labelledby="auth-callback-title">
        <MinacoBrandMark className="mx-auto mb-7 block h-14 w-14 overflow-hidden rounded-2xl" imageClassName="h-full w-full object-contain" />
        <span aria-hidden="true" className="mx-auto mb-6 block h-7 w-7 animate-spin rounded-full border-2 border-white/10 border-t-[#f2c36b] motion-reduce:animate-none" />
        <h1 id="auth-callback-title" className="text-2xl font-semibold tracking-tight">Completing your sign-in</h1>
        <div role="status" aria-live="polite" className="mt-3 min-h-16 text-sm leading-6 text-zinc-400">
          {takingLonger
            ? 'This is taking a little longer than usual. Please keep this page open while we finish signing you in.'
            : 'Please wait a moment. You’ll be taken to your workspace automatically.'}
        </div>
      </section>
    </main>
  );
}
