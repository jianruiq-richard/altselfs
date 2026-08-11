import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: {
      id: true,
      role: true,
      creditSubscription: { select: { planKey: true } },
    },
  });
  if (!user) return Response.json({ error: 'User context is not ready' }, { status: 404 });

  return Response.json({
    userId: user.id,
    role: user.role,
    planKey: user.creditSubscription?.planKey || 'FREE',
  });
}
