import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { CandidateSetupForm } from '@/components/candidate-setup-form';
import { InvestorWorkspaceSetup } from '@/components/investor-workspace-setup';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;
  const { userId } = await auth();
  if (!userId) {
    const setupTarget = role === 'candidate' ? '/dashboard/setup?role=candidate' : '/dashboard/setup?role=investor';
    redirect(`/sign-in?redirect_url=${encodeURIComponent(setupTarget)}`);
  }

  if (role === 'candidate') return <CandidateSetupForm />;

  return <InvestorWorkspaceSetup />;
}
