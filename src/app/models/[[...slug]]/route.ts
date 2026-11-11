import { loadMinacoProductCatalog } from '@/lib/minaco-product-catalog';
import { loadMarketingAccount } from '@/lib/marketing/account';
import { renderModelDirectory, renderModelPage } from '@/lib/marketing/models';
import { modelProfiles } from '@/lib/marketing/profiles';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await context.params;
  if (slug.length > 1 || (slug.length === 1 && !modelProfiles.some(m => m.slug === slug[0]))) {
    return new Response('Page not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } });
  }
  const [catalog, account] = await Promise.all([loadMinacoProductCatalog(), loadMarketingAccount()]);
  const html = slug.length ? renderModelPage(slug[0], catalog, account) : renderModelDirectory(catalog, account);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
