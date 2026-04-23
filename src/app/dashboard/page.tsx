import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';

export default async function Dashboard() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  // Check if user exists in our database
  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: {
      role: true,
    },
  });

  // If user doesn't exist in our database, show one-time OPC setup
  if (!dbUser) {
    redirect('/dashboard/setup?role=investor');
  }

  // Render based on user role
  if (dbUser.role === 'INVESTOR') {
    // Avoid duplicate auth + DB queries by letting /investor handle its own single load path.
    redirect('/investor');
  } else {
    redirect('/candidate');
  }
}
