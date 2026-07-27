import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { CandidateSetupForm } from '@/components/candidate-setup-form';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const { role } = await searchParams;
  if (role !== 'candidate') {
    redirect('/dashboard');
  }

  return <CandidateSetupForm />;
}
