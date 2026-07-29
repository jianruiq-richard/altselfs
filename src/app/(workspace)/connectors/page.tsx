import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { AstromarConnectorsPage } from '@/components/astromar-connectors-page';
import { loadInvestorConnectors } from '@/lib/investor-connectors-data';
import { prisma } from '@/lib/prisma';

export default async function ConnectorsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  const investor = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, email: true },
  });
  if (!investor) redirect('/sign-in');
  const initialData = await loadInvestorConnectors(investor).catch((error) => {
    console.error('Failed to preload connectors:', error);
    return null;
  });
  return <AstromarConnectorsPage initialData={initialData} />;
}
