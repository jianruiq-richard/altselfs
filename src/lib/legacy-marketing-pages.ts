// Retain direct access for existing users, but retire these pages from search
// while Minaco's public positioning focuses on the native Agent workspace.
// Keep this list explicit so future Desktop articles can be indexed normally.
export const legacyMarketingPaths = [
  '/agent',
  '/introduction',
  '/blog',
  '/blog/similarweb-alternatives',
  '/blog/semrush-alternatives',
  '/blog/ahrefs-alternatives',
  '/blog/appark-alternatives',
] as const;

export function isLegacyMarketingPath(path: string) {
  return legacyMarketingPaths.some((legacyPath) => legacyPath === path);
}
