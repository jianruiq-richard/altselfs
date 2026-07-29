import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { AstromarConnectorsPage } from '@/components/astromar-connectors-page';

export default async function ConnectorsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  return <AstromarConnectorsPage />;
}
