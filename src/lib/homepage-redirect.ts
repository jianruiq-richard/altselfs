const legacyPaths: Record<string, string> = {
  '/investor/chat/100': '/app',
  '/connectors': '/app/connectors',
  '/product-intelligence': '/app/product-intelligence',
  '/profile': '/app/settings',
};

/** Preserve shared links and campaign parameters while retiring old entry URLs. */
export function buildLegacyWorkspaceRedirect(requestUrl: URL) {
  const path = requestUrl.pathname.replace(/\/$/, '');
  const target = legacyPaths[path];
  if (!target) return null;
  const destination = new URL(requestUrl);
  destination.pathname = target;
  return destination;
}

export function buildSignedInHomepageRedirect(requestUrl: URL, userId: string | null) {
  if (requestUrl.pathname !== '/' || !userId) return null;
  const destination = new URL(requestUrl);
  destination.pathname = '/app';
  return destination;
}
