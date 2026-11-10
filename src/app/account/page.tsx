import { Suspense } from 'react';
import type { Metadata } from 'next';
import { MinacoAccountPage } from '@/components/minaco-account-page';

export const metadata: Metadata = {
  title: 'Account | Minaco',
  description: 'Manage your Minaco plan, shared Credits, usage history, billing, and current model rates.',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <Suspense fallback={<main>Loading account…</main>}><MinacoAccountPage /></Suspense>;
}
