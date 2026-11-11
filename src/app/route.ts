import { loadMinacoProductCatalog } from '@/lib/minaco-product-catalog';
import { renderLanding } from '@/lib/landing/render';
import { auth, currentUser } from '@clerk/nextjs/server';
import type { LandingAccount } from '@/lib/landing/account';

export const dynamic = 'force-dynamic';
// A standalone marketing document keeps the approved design isolated from legacy app CSS.
// Clerk middleware and all existing account, checkout and legal routes remain in place.
export async function GET() {
  const [catalog, account] = await Promise.all([loadMinacoProductCatalog(), loadLandingAccount()]);
  return new Response(renderLanding(catalog, undefined, account), {
    headers: {'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'},
  });
}

async function loadLandingAccount(): Promise<LandingAccount | null> {
  if (process.env.MINACO_WEBSITE_PREVIEW === '1') return null;
  const { userId } = await auth();
  if (!userId) return null;
  // A profile lookup failure must not make a valid session look signed out.
  const user = await currentUser().catch(() => null);
  return { name: user?.fullName || user?.username || '', imageUrl: user?.imageUrl || null };
}
