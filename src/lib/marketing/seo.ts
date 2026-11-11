import { productBrand } from '../brand';
import type { MinacoProductCatalog } from '../minaco-product-catalog';

export const canonicalOrigin = productBrand.canonicalUrl;
export const jsonLd = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
export const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function homepageStructuredData(catalog: MinacoProductCatalog) {
  return jsonLd([
    { '@context': 'https://schema.org', '@type': 'Organization', '@id': `${canonicalOrigin}/#organization`, name: 'Minaco', url: canonicalOrigin, logo: `${canonicalOrigin}/brand/minaco/png/minaco-app-icon-512.png` },
    { '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${canonicalOrigin}/#website`, name: 'Minaco', url: canonicalOrigin, publisher: { '@id': `${canonicalOrigin}/#organization` } },
    { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Minaco', applicationCategory: 'ProductivityApplication', operatingSystem: 'macOS 13 or later (Apple silicon)', url: canonicalOrigin, description: 'A desktop workspace for native AI agents, shared work context and one Minaco subscription.', ...(catalog.release ? { softwareVersion: catalog.release.version, downloadUrl: `${canonicalOrigin}/download` } : {}), publisher: { '@id': `${canonicalOrigin}/#organization` } },
  ]);
}

export function pageMetadata(path: string, title: string, description: string) {
  const url = canonicalOrigin + path;
  return `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="Minaco"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${canonicalOrigin}/landing/og-minaco.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${canonicalOrigin}/landing/og-minaco.png">`;
}
