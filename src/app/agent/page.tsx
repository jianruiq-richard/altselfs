import type { Metadata } from 'next';
import { AstromarLandingPage } from '@/components/astromar-landing-page';
import { productBrand } from '@/lib/brand';

const description = `${productBrand.name} Agent is the browser-based market-intelligence workspace for competitor research, business data, and recurring intelligence work.`;

export const metadata: Metadata = {
  title: `${productBrand.name} Agent | Market intelligence in your browser`,
  description,
  alternates: { canonical: '/agent' },
};

export default function AgentLandingPage() {
  return <AstromarLandingPage />;
}
