import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import type { ServerTiming } from '@/lib/server-timing';

export async function getInvestorOrNull(timing?: ServerTiming) {
  const { userId } = timing
    ? await timing.time('auth', () => auth(), 'Clerk authentication')
    : await auth();
  if (!userId) {
    return null;
  }

  const findUser = () => prisma.user.findUnique({
    where: { clerkId: userId },
  });
  const user = timing
    ? await timing.time('db_user', findUser, 'Resolve application user')
    : await findUser();

  return user;
}
