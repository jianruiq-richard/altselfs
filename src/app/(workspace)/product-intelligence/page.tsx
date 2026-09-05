import { ProductIntelligencePage } from '@/components/product-intelligence-page';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { hasProductIntelligenceAccess } from '@/lib/product-intelligence-access';
import { notFound } from 'next/navigation';

export default async function ProductIntelligenceRoute() {
  const investor = await getInvestorOrNull();
  if (!hasProductIntelligenceAccess(investor?.email)) notFound();

  return <ProductIntelligencePage />;
}
