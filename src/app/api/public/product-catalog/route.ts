import { loadMinacoProductCatalog } from '@/lib/minaco-product-catalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await loadMinacoProductCatalog(), {
    headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' },
  });
}
