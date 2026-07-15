type HttpMethod = 'GET' | 'POST';
type AnyRecord = Record<string, unknown>;

export type DajialaEndpointKey =
  | 'getVideoChannelWorks'
  | 'getVideoChannelReplay'
  | 'getVideoChannelId'
  | 'searchVideoChannelByKeyword'
  | 'getVideoDownloadUrl'
  | 'convertExportIdToObjectId'
  | 'searchVideoBySosuo1'
  | 'searchVideoAccountBySosuo'
  | 'getBoundVideoChannelByMpOriginId'
  | 'getVideoInteractionStats'
  | 'getVideoComments'
  | 'getMpTodayPosts'
  | 'getMpHistoryPosts'
  | 'getMpHistoryByOriginId'
  | 'getArticleStatsBasic'
  | 'getArticleStatsPro'
  | 'getArticleDetailTextRich'
  | 'getArticleHtml'
  | 'getArticleDetailPro'
  | 'getArticleCommentsPro'
  | 'getArticleInfoBatch'
  | 'getArticleDetailWithVideoDownload'
  | 'searchWechatArticlesDatabase'
  | 'searchWechatArticlesSegmented'
  | 'searchWechatRealtime'
  | 'searchWechatRealtimeMode1'
  | 'searchWechatRealtimeMode2'
  | 'searchMiniProgramBySosuo'
  | 'getWechatIndex'
  | 'getMpPopularArticles'
  | 'getMpSubjectInfo'
  | 'getMpBaseInfo'
  | 'getMpEstimatedMetrics'
  | 'searchMpsBySubject'
  | 'searchMpByKeyword'
  | 'searchMpBySosuo'
  | 'getCategoryMpRankings'
  | 'convertMpArticleUrl'
  | 'convertSogouTempUrl'
  | 'getApiBalance'
  | 'convertSogouArticleUrl';

type EndpointDefinition = {
  key: DajialaEndpointKey;
  label: string;
  method: HttpMethod;
  path: string;
};

const DEFAULT_BASE_URL = process.env.DAJIALA_BASE_URL || 'https://www.dajiala.com';
const API_KEY = process.env.DAJIALA_API_KEY || '';
const VERIFY_CODE = process.env.DAJIALA_VERIFY_CODE || '';

const DEFINITIONS: EndpointDefinition[] = [
  { key: 'getVideoChannelWorks', label: 'Get video channel posts', method: 'POST', path: '/fbmain/monitor/v3/video_channel_works' },
  { key: 'getVideoChannelReplay', label: 'Get video channel livestream replay', method: 'POST', path: '/fbmain/monitor/v3/video_live_replay' },
  { key: 'getVideoChannelId', label: 'Resolve video channel ID', method: 'POST', path: '/fbmain/monitor/v3/video_channel_id' },
  { key: 'searchVideoChannelByKeyword', label: 'Search video channels by keyword', method: 'POST', path: '/fbmain/monitor/v3/search_video_channel' },
  { key: 'getVideoDownloadUrl', label: 'Get video download URL', method: 'POST', path: '/fbmain/monitor/v3/video_download_url' },
  { key: 'convertExportIdToObjectId', label: 'Convert export_id to object_id', method: 'POST', path: '/fbmain/monitor/v3/convert_export_id' },
  { key: 'searchVideoBySosuo1', label: 'Search videos, mode 1', method: 'POST', path: '/fbmain/monitor/v3/sosuo_video_mode1' },
  { key: 'searchVideoAccountBySosuo', label: 'Search video channel accounts', method: 'POST', path: '/fbmain/monitor/v3/sosuo_video_account' },
  { key: 'getBoundVideoChannelByMpOriginId', label: 'Get video channel bound to official account origin ID', method: 'POST', path: '/fbmain/monitor/v3/mp_bind_video' },
  { key: 'getVideoInteractionStats', label: 'Get video interaction stats', method: 'POST', path: '/fbmain/monitor/v3/video_interaction' },
  { key: 'getVideoComments', label: 'Get video comments', method: 'POST', path: '/fbmain/monitor/v3/video_comments' },
  { key: 'getMpTodayPosts', label: 'Get today\'s official account posts', method: 'POST', path: '/fbmain/monitor/v3/post_today' },
  { key: 'getMpHistoryPosts', label: 'Get official account post history', method: 'POST', path: '/fbmain/monitor/v3/post_history' },
  { key: 'getMpHistoryByOriginId', label: 'Get post history by origin ID', method: 'POST', path: '/fbmain/monitor/v3/post_history_by_origin_id' },
  { key: 'getArticleStatsBasic', label: 'Get article reads, likes, and comments', method: 'POST', path: '/fbmain/monitor/v3/article_stats' },
  { key: 'getArticleStatsPro', label: 'Get pro article engagement metrics', method: 'POST', path: '/fbmain/monitor/v3/article_stats_pro' },
  { key: 'getArticleDetailTextRich', label: 'Get article detail in rich text', method: 'GET', path: '/fbmain/monitor/v3/article_detail' },
  { key: 'getArticleHtml', label: 'Get article HTML', method: 'GET', path: '/fbmain/monitor/v3/article_html' },
  { key: 'getArticleDetailPro', label: 'Get pro article detail', method: 'GET', path: '/fbmain/monitor/v3/article_detail_pro' },
  { key: 'getArticleCommentsPro', label: 'Get pro article comments', method: 'POST', path: '/fbmain/monitor/v3/article_comments_pro' },
  { key: 'getArticleInfoBatch', label: 'Get batch article info by URLs', method: 'POST', path: '/fbmain/monitor/v3/article_info' },
  { key: 'getArticleDetailWithVideoDownload', label: 'Get article detail with video download links', method: 'GET', path: '/fbmain/monitor/v3/article_detail_video' },
  { key: 'searchWechatArticlesDatabase', label: 'Search WeChat articles in database', method: 'POST', path: '/fbmain/monitor/v3/search_wechat_article' },
  { key: 'searchWechatArticlesSegmented', label: 'Search WeChat articles by segment', method: 'POST', path: '/fbmain/monitor/v3/search_wechat_article_segment' },
  { key: 'searchWechatRealtime', label: 'Search WeChat articles in realtime', method: 'POST', path: '/fbmain/monitor/v3/search_wechat_realtime' },
  { key: 'searchWechatRealtimeMode1', label: 'Realtime WeChat article search, mode 1', method: 'POST', path: '/fbmain/monitor/v3/search_wechat_realtime_mode1' },
  { key: 'searchWechatRealtimeMode2', label: 'Realtime WeChat article search, mode 2', method: 'POST', path: '/fbmain/monitor/v3/search_wechat_realtime_mode2' },
  { key: 'searchMiniProgramBySosuo', label: 'Search mini program accounts', method: 'POST', path: '/fbmain/monitor/v3/search_miniprogram' },
  { key: 'getWechatIndex', label: 'Get WeChat Index trends', method: 'POST', path: '/fbmain/monitor/v3/wechat_index' },
  { key: 'getMpPopularArticles', label: 'Get popular official account articles', method: 'POST', path: '/fbmain/monitor/v3/mp_popular_articles' },
  { key: 'getMpSubjectInfo', label: 'Get official account entity information', method: 'POST', path: '/fbmain/monitor/v3/principal_info' },
  { key: 'getMpBaseInfo', label: 'Get official account profile', method: 'POST', path: '/fbmain/monitor/v3/avatar_type' },
  { key: 'getMpEstimatedMetrics', label: 'Get estimated official account metrics', method: 'POST', path: '/fbmain/monitor/v3/mp_estimated_metrics' },
  { key: 'searchMpsBySubject', label: 'Search official accounts by organization', method: 'POST', path: '/fbmain/monitor/v3/search_mps_by_subject' },
  { key: 'searchMpByKeyword', label: 'Search official accounts by keyword', method: 'POST', path: '/fbmain/monitor/v3/wx_account/search' },
  { key: 'searchMpBySosuo', label: 'Search WeChat official accounts', method: 'POST', path: '/fbmain/monitor/v3/sosuo_mp' },
  { key: 'getCategoryMpRankings', label: 'Get official account category rankings', method: 'POST', path: '/fbmain/monitor/v3/mp_rankings' },
  { key: 'convertMpArticleUrl', label: 'Convert official account article URL', method: 'POST', path: '/fbmain/monitor/v3/convert_mp_article_url' },
  { key: 'convertSogouTempUrl', label: 'Convert Sogou temporary URL', method: 'POST', path: '/fbmain/monitor/v3/convert_sogou_temp_url' },
  { key: 'getApiBalance', label: 'Get API balance', method: 'POST', path: '/fbmain/monitor/v3/api_balance' },
  { key: 'convertSogouArticleUrl', label: 'Convert Sogou article URL', method: 'POST', path: '/fbmain/monitor/v3/convert_sogou_article_url' },
];

function parseOverrides() {
  const raw = process.env.DAJIALA_ENDPOINT_OVERRIDES;
  if (!raw) return {} as Partial<Record<DajialaEndpointKey, string>>;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed as Partial<Record<DajialaEndpointKey, string>>;
  } catch {
    return {} as Partial<Record<DajialaEndpointKey, string>>;
  }
}

function withAuth(params: AnyRecord) {
  const payload: AnyRecord = {
    key: API_KEY,
    ...params,
  };
  if (VERIFY_CODE) {
    payload.verifycode = VERIFY_CODE;
  }
  return payload;
}

function buildQuery(params: AnyRecord) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim()) {
      query.set(k, String(v));
    }
  });
  return query.toString();
}

async function parseResponseSafe(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text) as AnyRecord;
  } catch {
    return {
      ok: res.ok,
      status: res.status,
      raw: text,
    };
  }
}

export function isDajialaReady() {
  return Boolean(API_KEY.trim());
}

export function listDajialaEndpointDefinitions() {
  return DEFINITIONS;
}

export async function callDajialaEndpoint(key: DajialaEndpointKey, params: AnyRecord = {}) {
  if (!isDajialaReady()) {
    throw new Error('DAJIALA_API_KEY is not configured');
  }

  const endpoint = DEFINITIONS.find((item) => item.key === key);
  if (!endpoint) {
    throw new Error(`Unknown endpoint: ${key}`);
  }

  const overrides = parseOverrides();
  const path = overrides[key] || endpoint.path;
  if (!path) {
    throw new Error(`Endpoint path is not configured: ${key}`);
  }

  const authParams = withAuth(params);
  const url = `${DEFAULT_BASE_URL}${path}`;

  if (endpoint.method === 'GET') {
    const query = buildQuery(authParams);
    const res = await fetch(query ? `${url}?${query}` : url, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });
    return parseResponseSafe(res);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(authParams),
    signal: AbortSignal.timeout(15_000),
  });
  return parseResponseSafe(res);
}

export const DajialaRaw = {
  getVideoChannelWorks: (params: AnyRecord) => callDajialaEndpoint('getVideoChannelWorks', params),
  getVideoChannelReplay: (params: AnyRecord) => callDajialaEndpoint('getVideoChannelReplay', params),
  getVideoChannelId: (params: AnyRecord) => callDajialaEndpoint('getVideoChannelId', params),
  searchVideoChannelByKeyword: (params: AnyRecord) => callDajialaEndpoint('searchVideoChannelByKeyword', params),
  getVideoDownloadUrl: (params: AnyRecord) => callDajialaEndpoint('getVideoDownloadUrl', params),
  convertExportIdToObjectId: (params: AnyRecord) => callDajialaEndpoint('convertExportIdToObjectId', params),
  searchVideoBySosuo1: (params: AnyRecord) => callDajialaEndpoint('searchVideoBySosuo1', params),
  searchVideoAccountBySosuo: (params: AnyRecord) => callDajialaEndpoint('searchVideoAccountBySosuo', params),
  getBoundVideoChannelByMpOriginId: (params: AnyRecord) => callDajialaEndpoint('getBoundVideoChannelByMpOriginId', params),
  getVideoInteractionStats: (params: AnyRecord) => callDajialaEndpoint('getVideoInteractionStats', params),
  getVideoComments: (params: AnyRecord) => callDajialaEndpoint('getVideoComments', params),
  getMpTodayPosts: (params: AnyRecord) => callDajialaEndpoint('getMpTodayPosts', params),
  getMpHistoryPosts: (params: AnyRecord) => callDajialaEndpoint('getMpHistoryPosts', params),
  getMpHistoryByOriginId: (params: AnyRecord) => callDajialaEndpoint('getMpHistoryByOriginId', params),
  getArticleStatsBasic: (params: AnyRecord) => callDajialaEndpoint('getArticleStatsBasic', params),
  getArticleStatsPro: (params: AnyRecord) => callDajialaEndpoint('getArticleStatsPro', params),
  getArticleDetailTextRich: (params: AnyRecord) => callDajialaEndpoint('getArticleDetailTextRich', params),
  getArticleHtml: (params: AnyRecord) => callDajialaEndpoint('getArticleHtml', params),
  getArticleDetailPro: (params: AnyRecord) => callDajialaEndpoint('getArticleDetailPro', params),
  getArticleCommentsPro: (params: AnyRecord) => callDajialaEndpoint('getArticleCommentsPro', params),
  getArticleInfoBatch: (params: AnyRecord) => callDajialaEndpoint('getArticleInfoBatch', params),
  getArticleDetailWithVideoDownload: (params: AnyRecord) => callDajialaEndpoint('getArticleDetailWithVideoDownload', params),
  searchWechatArticlesDatabase: (params: AnyRecord) => callDajialaEndpoint('searchWechatArticlesDatabase', params),
  searchWechatArticlesSegmented: (params: AnyRecord) => callDajialaEndpoint('searchWechatArticlesSegmented', params),
  searchWechatRealtime: (params: AnyRecord) => callDajialaEndpoint('searchWechatRealtime', params),
  searchWechatRealtimeMode1: (params: AnyRecord) => callDajialaEndpoint('searchWechatRealtimeMode1', params),
  searchWechatRealtimeMode2: (params: AnyRecord) => callDajialaEndpoint('searchWechatRealtimeMode2', params),
  searchMiniProgramBySosuo: (params: AnyRecord) => callDajialaEndpoint('searchMiniProgramBySosuo', params),
  getWechatIndex: (params: AnyRecord) => callDajialaEndpoint('getWechatIndex', params),
  getMpPopularArticles: (params: AnyRecord) => callDajialaEndpoint('getMpPopularArticles', params),
  getMpSubjectInfo: (params: AnyRecord) => callDajialaEndpoint('getMpSubjectInfo', params),
  getMpBaseInfo: (params: AnyRecord) => callDajialaEndpoint('getMpBaseInfo', params),
  getMpEstimatedMetrics: (params: AnyRecord) => callDajialaEndpoint('getMpEstimatedMetrics', params),
  searchMpsBySubject: (params: AnyRecord) => callDajialaEndpoint('searchMpsBySubject', params),
  searchMpByKeyword: (params: AnyRecord) => callDajialaEndpoint('searchMpByKeyword', params),
  searchMpBySosuo: (params: AnyRecord) => callDajialaEndpoint('searchMpBySosuo', params),
  getCategoryMpRankings: (params: AnyRecord) => callDajialaEndpoint('getCategoryMpRankings', params),
  convertMpArticleUrl: (params: AnyRecord) => callDajialaEndpoint('convertMpArticleUrl', params),
  convertSogouTempUrl: (params: AnyRecord) => callDajialaEndpoint('convertSogouTempUrl', params),
  getApiBalance: (params: AnyRecord) => callDajialaEndpoint('getApiBalance', params),
  convertSogouArticleUrl: (params: AnyRecord) => callDajialaEndpoint('convertSogouArticleUrl', params),
};
