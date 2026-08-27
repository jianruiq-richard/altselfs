// Product visibility only: hidden connectors keep their integrations and accounts.
// Gmail and Lark are temporarily omitted from all workspace connector controls.
const VISIBLE_CONNECTOR_KEYS = new Set([
  'instagram_looter2',
  'twitter241',
  'tiktok_api23',
  'youtube_v2',
  'similarweb_api1',
  'semrush13',
  'ahrefs_url_research',
  'domain_metrics_check',
  'appark',
]);

export function getVisibleConnectors<T extends { key: string }>(connectors: readonly T[]): T[] {
  return connectors.filter((connector) => VISIBLE_CONNECTOR_KEYS.has(connector.key));
}
