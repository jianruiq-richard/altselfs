import type { Metadata } from 'next';
import type { ReactNode } from 'react';
export const metadata: Metadata = { title: 'Connect your account | Minaco Desktop', description: 'Sign in or create your account for Minaco Desktop.', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function DesktopAccountLayout({ children }: { children: ReactNode }) { return children; }
