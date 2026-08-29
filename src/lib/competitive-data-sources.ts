import { COMPETITIVE_CONNECTOR_DISPLAY_NAMES } from '@/lib/competitive-connector-presentation';
import { getVisibleConnectors } from '@/lib/investor-connector-visibility';

export const COMPETITIVE_DATA_SOURCES = {
  instagram_looter2: {
    label: COMPETITIVE_CONNECTOR_DISPLAY_NAMES.instagram_looter2,
    accountName: `${COMPETITIVE_CONNECTOR_DISPLAY_NAMES.instagram_looter2} teammate`,
    description: 'Recent official Instagram posts and Reels plus tagged KOC or creator promotion candidates, with dates, links, engagement, and promotion signals.',
    dbProvider: 'INSTAGRAM_LOOTER2',
    scope: 'profile_resolution,official_posts,reels,tagged_koc_candidates,engagement,promotion_signals',
  },
  twitter241: {
    label: COMPETITIVE_CONNECTOR_DISPLAY_NAMES.twitter241,
    accountName: `${COMPETITIVE_CONNECTOR_DISPLAY_NAMES.twitter241} teammate`,
    description: 'Official X posts plus creator/KOC promotion candidates and organic discussion, with exact dates, links, views, engagement, and evidence signals.',
    dbProvider: 'TWITTER241',
    scope: 'profile_resolution,official_posts,replies,creator_koc_candidates,organic_discussion,exact_publication_filter,views,engagement,promotion_signals',
  },
  tiktok_api23: {
    label: COMPETITIVE_CONNECTOR_DISPLAY_NAMES.tiktok_api23,
    accountName: `${COMPETITIVE_CONNECTOR_DISPLAY_NAMES.tiktok_api23} teammate`,
    description: 'General-purpose public TikTok account search, user profiles, user posts, video search, and post discovery with caller-controlled queries and filters.',
    dbProvider: 'TIKTOK_API23',
    scope: 'account_search,user_info,user_posts,video_search,post_discovery,pagination,publication_filter',
  },
  youtube_v2: {
    label: COMPETITIVE_CONNECTOR_DISPLAY_NAMES.youtube_v2,
    accountName: `${COMPETITIVE_CONNECTOR_DISPLAY_NAMES.youtube_v2} teammate`,
    description: 'Official channel videos and Shorts plus keyword-discovered KOC or creator promotion candidates, with exact dates, links, views, and promotion signals.',
    dbProvider: 'YOUTUBE_V2',
    scope: 'channel_resolution,official_videos,shorts,keyword_koc_candidates,publication_dates,views,promotion_signals',
  },
  similarweb_api1: {
    label: 'Similarweb',
    accountName: 'Similarweb API1 teammate',
    description: 'Website traffic, engagement, rankings, traffic channels, geography, referrals, and similar-site signals.',
    dbProvider: 'SIMILARWEB_API1',
    scope: 'traffic,trend,countries,devices,sources,keywords,competitors',
  },
  semrush13: {
    label: 'Semrush',
    accountName: 'Semrush13 teammate',
    description: 'Domain SEO intelligence: traffic estimates, organic and paid keywords, backlinks, competitors, geography, and visibility signals.',
    dbProvider: 'SEMRUSH13',
    scope: 'traffic,growth,search,countries,devices,journey,backlinks_summary,keywords,competitors',
  },
  semrush8: {
    label: 'Semrush8',
    accountName: 'Semrush8 teammate',
    description: 'SEO rank, keyword, backlink, and URL traffic analysis.',
    dbProvider: 'SEMRUSH8',
    scope: 'seo_rank,keywords,traffic,cost,links,url_traffic',
  },
  ahrefs_url_research: {
    label: 'Ahrefs URL Research',
    accountName: 'Ahrefs URL Research teammate',
    description: 'URL-level SEO metrics: authority, backlinks, referring domains, organic keywords, traffic proxy, and link footprint signals.',
    dbProvider: 'AHREFS_URL_RESEARCH',
    scope: 'url_metrics,authority,backlinks,referring_domains,organic_keywords,organic_traffic',
  },
  domain_metrics_check: {
    label: 'Domain Metrics Check',
    accountName: 'Domain Metrics Check teammate',
    description: 'Domain authority checks across DA/PA, spam score, Trust Flow, Citation Flow, DR, backlinks, and referring domains.',
    dbProvider: 'DOMAIN_METRICS_CHECK',
    scope: 'moz,majestic,ahrefs_style_metrics,authority,backlinks,referring_domains',
  },
  appark: {
    label: 'Appark',
    accountName: 'Appark teammate',
    description: 'Mobile app intelligence: App Store and Google Play search, app metadata, ratings, downloads, revenue estimates, country split, and competitors.',
    dbProvider: 'APPARK',
    scope: 'mobile_app_search,app_metadata,ratings,downloads,revenue_estimates,country_split,competitors',
  },
} as const;

export type CompetitiveDataSourceProvider = keyof typeof COMPETITIVE_DATA_SOURCES;

export const COMPETITIVE_DATA_SOURCE_LIST = (
  Object.keys(COMPETITIVE_DATA_SOURCES) as CompetitiveDataSourceProvider[]
).map((key) => ({ key, ...COMPETITIVE_DATA_SOURCES[key] }));

export function toCompetitiveDataSourceProvider(value: string): CompetitiveDataSourceProvider | null {
  return Object.hasOwn(COMPETITIVE_DATA_SOURCES, value) ? value as CompetitiveDataSourceProvider : null;
}

export function buildDefaultVisibleCompetitiveIntegrations(investorId: string, connectedAt = new Date()) {
  return getVisibleConnectors(COMPETITIVE_DATA_SOURCE_LIST).map((connector) => ({
    investorId,
    provider: connector.dbProvider,
    status: 'CONNECTED',
    accountName: connector.accountName,
    accountEmail: 'platform-provided',
    scope: connector.scope,
    connectedAt,
  }));
}
