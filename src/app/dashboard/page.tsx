import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import InvestorDashboard from '@/app/investor/page';

export default async function Dashboard() {
  const user = await currentUser();

  if (!user) {
    redirect('/sign-in');
  }

  // Check if user exists in our database
  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id }
  });

  // If user doesn't exist in our database, show one-time OPC setup
  if (!dbUser) {
    redirect('/dashboard/setup?role=investor');
  }

  // Render based on user role
  if (dbUser.role === 'INVESTOR') {
    return InvestorDashboard();
  } else {
    redirect('/candidate');
  }
}
