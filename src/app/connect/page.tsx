import type { Metadata } from 'next';
import { DesktopAuthShell, InvalidDesktopRequest } from '@/components/desktop-auth-shell';
import { DesktopConnect } from '@/components/desktop-connect';
import { desktopRegistrationRequest } from '@/lib/desktop-registration';

export const metadata: Metadata = { title: 'Connect Minaco Desktop', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ request?: string; registered?: string }> }) {
  const params = await searchParams;
  const request = desktopRegistrationRequest(params.request);
  if (!request) return <InvalidDesktopRequest />;
  const apiUrl = process.env.MINACO_DESKTOP_API_URL || 'https://desktop-api.minaco.ai';
  return <DesktopAuthShell step={2} title="Connect Minaco Desktop" description="Choose the Minaco account to use on this device.">
    <DesktopConnect requestId={request} registered={params.registered === '1'} apiUrl={apiUrl} />
  </DesktopAuthShell>;
}
