import type { Metadata, Viewport } from 'next';
import { MinacoDesktopLandingPage } from '@/components/minaco-desktop-landing-page';
import { productBrand } from '@/lib/brand';
import { loadMinacoProductCatalog } from '@/lib/minaco-product-catalog';

export const dynamic = 'force-dynamic';

const homepageDescription =
  'Use supported native AI Agents and their ecosystems with one Minaco subscription. Switch specialists without restarting the work.';

export const metadata: Metadata = {
  title: 'Minaco | Your Agents. One workspace.',
  description: homepageDescription,
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Minaco | Your Agents. One workspace.',
    description: homepageDescription,
    url: productBrand.canonicalUrl,
    siteName: productBrand.name,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Minaco | Your Agents. One workspace.',
    description: homepageDescription,
  },
};

export const viewport: Viewport = { themeColor: '#090909' };

export default async function Home() {
  const catalog = await loadMinacoProductCatalog();
  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Minaco Desktop',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS',
      description: homepageDescription,
      url: productBrand.canonicalUrl,
      downloadUrl: catalog.release?.url,
      softwareVersion: catalog.release?.version,
      offers: catalog.plans.filter((plan) => plan.priceUsd > 0).map((plan) => ({
        '@type': 'Offer',
        name: plan.name,
        price: plan.priceUsd,
        priceCurrency: 'USD',
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: productBrand.name,
      url: productBrand.canonicalUrl,
      logo: `${productBrand.canonicalUrl}/brand/minaco/png/minaco-app-icon-512.png`,
    },
  ];

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
    <MinacoDesktopLandingPage catalog={catalog} />
  </>;
}
