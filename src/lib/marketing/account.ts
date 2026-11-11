import { auth, currentUser } from '@clerk/nextjs/server';
import type { LandingAccount } from '../landing/account';

export async function loadMarketingAccount(): Promise<LandingAccount | null> {
  if (process.env.MINACO_WEBSITE_PREVIEW === '1') return null;
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser().catch(() => null);
  return { name: user?.fullName || user?.username || '', imageUrl: user?.imageUrl || null };
}
