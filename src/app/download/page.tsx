import type { Metadata, Viewport } from 'next';
import { MinacoDownloadPage } from '@/components/minaco-download-page';
import { loadMinacoProductCatalog } from '@/lib/minaco-product-catalog';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Download Minaco for macOS',
  description: 'Download the signed Minaco Desktop app for Apple silicon, then connect your Minaco account in the app.',
  alternates: { canonical: '/download' },
};

export const viewport: Viewport = { themeColor: '#090909' };

export default async function DownloadPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const [catalog, params] = await Promise.all([loadMinacoProductCatalog(), searchParams]);
  return <MinacoDownloadPage release={catalog.release} workspace={params.workspace?.trim() || null} />;
}
