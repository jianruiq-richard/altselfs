export type CampaignSearchParams = Record<string, string | string[] | undefined>;

export const CAMPAIGN_QUERY_KEYS = [
  'utm_id',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_source_platform',
  'utm_term',
  'utm_content',
  'utm_creative_format',
  'utm_marketing_tactic',
] as const;

export function appendCampaignParams(
  path: string,
  searchParams: CampaignSearchParams,
) {
  const campaignParams = new URLSearchParams();

  for (const key of CAMPAIGN_QUERY_KEYS) {
    const rawValues = searchParams[key];
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];

    for (const value of values) {
      const normalized = value?.trim();
      if (normalized) campaignParams.append(key, normalized);
    }
  }

  const query = campaignParams.toString();
  if (!query) return path;

  const separator = path.includes('?')
    ? path.endsWith('?') || path.endsWith('&') ? '' : '&'
    : '?';
  return `${path}${separator}${query}`;
}
