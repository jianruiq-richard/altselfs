import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

export const dynamic = 'force-dynamic';

const FORWARDED_QUERY_KEYS = ['q', 'category', 'productType', 'dataset', 'sort', 'limit', 'offset'] as const;

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
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
        'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Failed to load product intelligence:', error);
    return Response.json({ error: 'Product intelligence is temporarily unavailable.' }, { status: 503 });
  }
}
