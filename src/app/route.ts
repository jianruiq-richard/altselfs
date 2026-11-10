import { loadMinacoProductCatalog } from '@/lib/minaco-product-catalog';
import { renderLanding } from '@/lib/landing/render';

export const dynamic = 'force-dynamic';
// A standalone marketing document keeps the approved design isolated from legacy app CSS.
// Clerk middleware and all existing account, checkout and legal routes remain in place.
export async function GET() {
  return new Response(renderLanding(await loadMinacoProductCatalog()), {
    headers: {'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'},
  });
}
