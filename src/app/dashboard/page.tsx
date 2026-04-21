import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';

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

  // Redirect based on user role
  if (dbUser.role === 'INVESTOR') {
    redirect('/investor');
  } else {
    redirect('/candidate');
  }
}
