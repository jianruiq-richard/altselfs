export type AuthSearchParams = { method?: string; redirect_url?: string; redirectUrl?: string; next?: string };
export function authDestination(value: unknown, fallback = '/get-started'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u0020\u007f]/.test(decoded) || decoded.startsWith('//')) return fallback;
    const url = new URL(value, 'https://minaco.ai');
    if (url.origin !== 'https://minaco.ai' || /^\/(sign-in|sign-up|sso-callback|auth)(\/|$)/.test(decodeURIComponent(url.pathname))) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}
export function authHref(path: string, target: string, method?: 'email' | 'phone') {
  const query = new URLSearchParams({ redirect_url: target });
  if (method) query.set('method', method);
  return `${path}?${query}`;
}
