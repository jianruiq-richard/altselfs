import {
  appendCampaignParams,
  CAMPAIGN_QUERY_KEYS,
  type CampaignSearchParams,
} from './analytics/campaign';

const WORKSPACE_PATH = '/investor/chat/100';

export function buildSignedInHomepageRedirect(
  requestUrl: URL,
  userId: string | null,
) {
  if (!userId || requestUrl.pathname !== '/') return null;

  const campaignSearchParams: CampaignSearchParams = {};

  for (const key of CAMPAIGN_QUERY_KEYS) {
    const values = requestUrl.searchParams.getAll(key);
    if (values.length > 0) campaignSearchParams[key] = values;
  }

  return new URL(
    appendCampaignParams(WORKSPACE_PATH, campaignSearchParams),
    requestUrl,
  );
}
