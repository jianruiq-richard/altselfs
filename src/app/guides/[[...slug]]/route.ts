export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await context.params;
  const anchor = slug[0] === 'one-subscription-multiple-agents' ? '#usage' : slug.length ? '#switch-agents' : '';
  return new Response(null, { status: 308, headers: { Location: `/guidance${anchor}`, 'Cache-Control': 'public, max-age=3600' } });
}
