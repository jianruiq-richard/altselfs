import { artifactContentDisposition, GENERATED_HTML_PREVIEW_CSP } from '@/lib/artifact-delivery';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

type ResolveShareResponse = {
  ok?: boolean;
  url?: string;
  artifact?: {
    name?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
  };
  share?: {
    expiresAt?: string | null;
  };
  error?: string;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!token) return unavailableShareResponse();

  try {
    const data = await personalAgentInternalFetch<ResolveShareResponse>('/internal/artifacts/shares/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }, {
      attempts: 1,
    });
    if (!data.url) return unavailableShareResponse();

    const upstream = await fetch(data.url, {
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!upstream.ok || !upstream.body) return unavailableShareResponse(502);

    const artifactName = data.artifact?.name?.trim() || 'shared-report.html';
    const headers = new Headers({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': artifactContentDisposition('preview', artifactName),
      'Content-Security-Policy': GENERATED_HTML_PREVIEW_CSP,
      'Content-Type': 'text/html; charset=utf-8',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
    const contentLength = upstream.headers.get('content-length');
    if (contentLength && /^\d+$/.test(contentLength)) headers.set('Content-Length', contentLength);
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return unavailableShareResponse();
  }
}

function unavailableShareResponse(status = 404) {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Share unavailable</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;font:16px/1.5 system-ui,sans-serif}.card{max-width:32rem;margin:2rem;padding:2rem;border:1px solid #333;border-radius:1rem;background:#1b1b1b}h1{margin:0 0 .75rem;font-size:1.25rem}p{margin:0;color:#aaa}</style></head><body><main class="card"><h1>This share link is unavailable</h1><p>It may have expired, been revoked, or the file may no longer exist.</p></main></body></html>',
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    }
  );
}
