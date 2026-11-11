import { loadMarketingAccount } from '@/lib/marketing/account';
import { renderGuide, renderGuideIndex } from '@/lib/marketing/render';
import { guides } from '@/lib/marketing/content';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await context.params;
  if (slug.length > 1 || (slug.length === 1 && !guides.some(g => g.slug === slug[0]))) {
    return new Response('Page not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } });
  }
  const account = await loadMarketingAccount();
  return new Response(slug.length ? renderGuide(slug[0], account) : renderGuideIndex(account), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
