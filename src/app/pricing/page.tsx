import type { Metadata } from 'next';
import { PublicPricingPage } from '@/components/public-pricing-page';

export const metadata: Metadata = {
  title: 'Pricing & Credits | Minaco',
  description: 'Compare Minaco plans, shared Credits, and model rates for supported native AI agents in one desktop workspace.',
  alternates: { canonical: '/pricing' },
};

export default function PricingPage() { return <PublicPricingPage />; }
