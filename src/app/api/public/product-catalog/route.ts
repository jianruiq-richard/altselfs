import { loadMinacoProductCatalog, publicProductCatalog } from '@/lib/minaco-product-catalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  const catalog = publicProductCatalog(await loadMinacoProductCatalog());
  return Response.json(catalog, {
    headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' },
  });
}
