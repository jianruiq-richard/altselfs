import { loadMinacoProductCatalog } from '@/lib/minaco-product-catalog';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { release } = await loadMinacoProductCatalog();
  if (!release) return new Response('The macOS download is temporarily unavailable. Please try again shortly.', {
    status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Retry-After':'30'},
  });
  const target = new URL(release.url);
  if(target.protocol !== 'https:' || target.username || target.password || !target.pathname.toLowerCase().endsWith('.dmg')) {
    return new Response('The macOS download is temporarily unavailable.',{status:503,headers:{'Cache-Control':'no-store'}});
  }
  return new Response(null,{status:302,headers:{Location:target.href,'Cache-Control':'no-store'}});
}
