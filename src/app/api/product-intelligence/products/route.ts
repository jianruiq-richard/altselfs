import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { hasProductIntelligenceAccess } from '@/lib/product-intelligence-access';

export const dynamic = 'force-dynamic';

const FORWARDED_QUERY_KEYS = ['q', 'category', 'sort', 'limit'] as const;

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const developmentPreview = process.env.NODE_ENV !== 'production' && requestUrl.searchParams.get('preview') === '1';
  if (!developmentPreview) {
    const investor = await getInvestorOrNull();
    if (!investor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasProductIntelligenceAccess(investor.email)) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
  }

  const upstreamQuery = new URLSearchParams();
  for (const key of FORWARDED_QUERY_KEYS) {
    const value = requestUrl.searchParams.get(key)?.trim();
    if (value) upstreamQuery.set(key, value);
  }

  try {
    const query = upstreamQuery.toString();
    const path = `/internal/market-intelligence/products${query ? `?${query}` : ''}`;
    const result = await personalAgentInternalFetch(path);
    return Response.json(result, {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('Failed to load product intelligence:', error);
    return Response.json({ error: 'Product intelligence is temporarily unavailable.' }, { status: 503 });
  }
}
