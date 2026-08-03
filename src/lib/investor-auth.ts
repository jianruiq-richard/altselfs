import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import type { ServerTiming } from '@/lib/server-timing';
import { provisionProductUser } from '@/lib/user-provisioning';

async function provisionCurrentInvestorUser(clerkUserId: string) {
  const clerkUser = await currentUser();
  if (!clerkUser || clerkUser.id !== clerkUserId) {
    return null;
  }

  const email =
    clerkUser.primaryEmailAddress?.emailAddress ||
    clerkUser.emailAddresses.find((item) => item.id === clerkUser.primaryEmailAddressId)?.emailAddress ||
    clerkUser.emailAddresses[0]?.emailAddress ||
    null;

  return provisionProductUser({
    clerkId: clerkUser.id,
    email,
    name: clerkUser.fullName || clerkUser.username,
    role: 'INVESTOR',
  });
}

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

  if (user) {
    return user;
  }

  const provisionUser = () => provisionCurrentInvestorUser(userId);
  return timing
    ? await timing.time('db_user_provision', provisionUser, 'Provision application user')
    : await provisionUser();
}
