const legacyPaths: Record<string, string> = {
  '/investor/chat/100': '/app',
  '/connectors': '/app/connectors',
  '/product-intelligence': '/app/product-intelligence',
  '/profile': '/account',
};

/** Preserve shared links and campaign parameters while retiring old entry URLs. */
export function buildLegacyWorkspaceRedirect(requestUrl: URL) {
  const path = requestUrl.pathname.replace(/\/$/, '');
  if (path === '/app/settings' && requestUrl.searchParams.get('view') === 'plan') {
    const destination = new URL(requestUrl);
    destination.pathname = '/account';
    destination.searchParams.set('view', 'plan');
    return destination;
  }
  const target = legacyPaths[path];
  if (!target) return null;
  const destination = new URL(requestUrl);
  destination.pathname = target;
  if (path === '/profile' && !destination.searchParams.has('view')) destination.searchParams.set('view', destination.searchParams.has('billing') ? 'billing' : 'overview');
  return destination;
}

// The public homepage remains available after sign-in; Web Agent has its own /app entry.
export function buildSignedInHomepageRedirect(_requestUrl: URL, _userId: string | null) { return null; }
