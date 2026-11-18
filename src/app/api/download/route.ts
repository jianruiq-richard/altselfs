import { loadMinacoProductCatalog } from '@/lib/minaco-product-catalog';
import { recordDesktopDownload } from '@/lib/analytics/posthog';
import { resolveMacDownloadPlatform } from '@/lib/mac-download-platform';
import type { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const catalog = await loadMinacoProductCatalog();
  const platform = resolveMacDownloadPlatform(
    request.nextUrl.searchParams.get('arch'),
    request.headers.get('sec-ch-ua-arch'),
  );
  const release = catalog.releases?.find((item) => item.platform === platform)
    || (platform === 'darwin-arm64' ? catalog.release : null);
  if (!release) return new Response('The macOS download is temporarily unavailable. Please try again shortly.', {
    status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Retry-After':'30'},
  });
  const target = new URL(release.url);
  if(target.protocol !== 'https:' || target.username || target.password || !target.pathname.toLowerCase().endsWith('.dmg')) {
    return new Response('The macOS download is temporarily unavailable.',{status:503,headers:{'Cache-Control':'no-store'}});
  }
  const anonymousId = request.cookies.get('minaco_ph_id')?.value;
  if (anonymousId) await recordDesktopDownload(anonymousId, release);
  return new Response(null,{status:302,headers:{
    Location:target.href,
    'Cache-Control':'no-store',
    'Accept-CH':'Sec-CH-UA-Arch',
    Vary:'Sec-CH-UA-Arch',
  }});
}
