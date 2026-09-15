'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { getConsentChoice, saveConsentChoice, subscribeConsent, type ConsentChoice } from '@/lib/analytics/consent';

export function AnalyticsConsent() {
  const choice = useSyncExternalStore(subscribeConsent, getConsentChoice, () => 'loading');
  const [editing, setEditing] = useState(false);
  const configured = Boolean(process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID);
  if (!configured || choice === 'loading') return null;
  const select = (value: ConsentChoice) => {
    saveConsentChoice(value);
    setEditing(false);
  };
  if (!editing) {
    return <button type="button" onClick={() => setEditing(true)} className="fixed bottom-2 left-2 z-50 rounded-full border border-white/10 bg-zinc-950/90 px-3 py-1 text-[10px] text-zinc-400 hover:text-white">Cookie preferences</button>;
  }
  return (
    <section aria-label="Cookie preferences" className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-2xl border border-white/15 bg-zinc-950 p-5 text-sm text-zinc-300 shadow-2xl">
      <h2 className="font-semibold text-white">Your privacy choices</h2>
      <p className="mt-2 leading-relaxed">Analytics and advertising measurement are enabled by default unless you have saved a different preference. You can allow analytics only, include advertising measurement, or decline. Change your choice anytime. <Link href="/privacy#cookies" className="underline underline-offset-2">Privacy policy</Link></p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => select('all')} className="rounded-lg border border-white/20 px-4 py-2 text-white hover:bg-white/10">Allow analytics &amp; ads measurement</button>
        <button type="button" onClick={() => select('analytics')} className="rounded-lg border border-white/20 px-4 py-2 text-white hover:bg-white/10">Analytics only</button>
        <button type="button" onClick={() => select('denied')} className="rounded-lg border border-white/20 px-4 py-2 text-white hover:bg-white/10">Decline</button>
        {editing && <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-2 text-zinc-400 hover:text-white">Close</button>}
      </div>
    </section>
  );
}
