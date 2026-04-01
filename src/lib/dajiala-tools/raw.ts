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
  { key: 'getVideoChannelWorks', label: '获取单个视频号作品列表（可翻页）', method: 'POST', path: '/fbmain/monitor/v3/video_channel_works' },
  { key: 'getVideoChannelReplay', label: '获取视频号直播回放记录', method: 'POST', path: '/fbmain/monitor/v3/video_live_replay' },
  { key: 'getVideoChannelId', label: '获取指定视频号ID', method: 'POST', path: '/fbmain/monitor/v3/video_channel_id' },
  { key: 'searchVideoChannelByKeyword', label: '关键词搜索视频号', method: 'POST', path: '/fbmain/monitor/v3/search_video_channel' },
  { key: 'getVideoDownloadUrl', label: '获取视频号可下载链接', method: 'POST', path: '/fbmain/monitor/v3/video_download_url' },
  { key: 'convertExportIdToObjectId', label: 'export_id转object_id', method: 'POST', path: '/fbmain/monitor/v3/convert_export_id' },
  { key: 'searchVideoBySosuo1', label: '搜一搜搜视频1', method: 'POST', path: '/fbmain/monitor/v3/sosuo_video_mode1' },
  { key: 'searchVideoAccountBySosuo', label: '搜一搜搜视频账号', method: 'POST', path: '/fbmain/monitor/v3/sosuo_video_account' },
  { key: 'getBoundVideoChannelByMpOriginId', label: '通过公众号原始id获取绑定的视频号', method: 'POST', path: '/fbmain/monitor/v3/mp_bind_video' },
  { key: 'getVideoInteractionStats', label: '获取视频号视频互动信息', method: 'POST', path: '/fbmain/monitor/v3/video_interaction' },
  { key: 'getVideoComments', label: '获取视频号视频评论', method: 'POST', path: '/fbmain/monitor/v3/video_comments' },
  { key: 'getMpTodayPosts', label: '通过公众号名称/微信Id/链接获取当天发文情况', method: 'POST', path: '/fbmain/monitor/v3/post_today' },
  { key: 'getMpHistoryPosts', label: '通过公众号名称/微信Id/链接获取历史发文列表', method: 'POST', path: '/fbmain/monitor/v3/post_history' },
  { key: 'getMpHistoryByOriginId', label: '通过公众号原始id获取历史列表', method: 'POST', path: '/fbmain/monitor/v3/post_history_by_origin_id' },
  { key: 'getArticleStatsBasic', label: '获取文章阅读、点赞、在看', method: 'POST', path: '/fbmain/monitor/v3/article_stats' },
  { key: 'getArticleStatsPro', label: '获取文章阅读、点赞、在看、转发、收藏、评论 Pro', method: 'POST', path: '/fbmain/monitor/v3/article_stats_pro' },
  { key: 'getArticleDetailTextRich', label: '获取文章详情(纯文本/富文本)', method: 'GET', path: '/fbmain/monitor/v3/article_detail' },
  { key: 'getArticleHtml', label: '获取文章正文HTML', method: 'GET', path: '/fbmain/monitor/v3/article_html' },
  { key: 'getArticleDetailPro', label: '获取文章详情Pro', method: 'GET', path: '/fbmain/monitor/v3/article_detail_pro' },
  { key: 'getArticleCommentsPro', label: '获取公众号文章评论Pro', method: 'POST', path: '/fbmain/monitor/v3/article_comments_pro' },
  { key: 'getArticleInfoBatch', label: '获取文章阅读/点赞/标题/URL等', method: 'POST', path: '/fbmain/monitor/v3/article_info' },
  { key: 'getArticleDetailWithVideoDownload', label: '获取文章详情(视频可下载)', method: 'GET', path: '/fbmain/monitor/v3/article_detail_video' },
  { key: 'searchWechatArticlesDatabase', label: '关键词搜索微信文章(数据库)', method: 'POST', path: '/fbmain/monitor/v3/search_wechat_article' },
  { key: 'searchWechatArticlesSegmented', label: '分词搜索微信文章2(数据库)', method: 'POST', path: '/fbmain/monitor/v3/search_wechat_article_segment' },
  { key: 'searchWechatRealtime', label: '获取微信搜一搜结果(实时)', method: 'POST', path: '/fbmain/monitor/v3/search_wechat_realtime' },
  { key: 'searchWechatRealtimeMode1', label: '搜一搜实时搜文章1(mode1)', method: 'POST', path: '/fbmain/monitor/v3/search_wechat_realtime_mode1' },
  { key: 'searchWechatRealtimeMode2', label: '搜一搜实时搜文章2(mode2)', method: 'POST', path: '/fbmain/monitor/v3/search_wechat_realtime_mode2' },
  { key: 'searchMiniProgramBySosuo', label: '搜一搜搜小程序账号', method: 'POST', path: '/fbmain/monitor/v3/search_miniprogram' },
  { key: 'getWechatIndex', label: '获取微信指数', method: 'POST', path: '/fbmain/monitor/v3/wechat_index' },
  { key: 'getMpPopularArticles', label: '公众号爆文api', method: 'POST', path: '/fbmain/monitor/v3/mp_popular_articles' },
  { key: 'getMpSubjectInfo', label: '获取公众号主体信息', method: 'POST', path: '/fbmain/monitor/v3/mp_subject_info' },
  { key: 'getMpBaseInfo', label: '获取公众号基础信息', method: 'POST', path: '/fbmain/monitor/v3/mp_base_info' },
  { key: 'getMpEstimatedMetrics', label: '获取公众号预估指标', method: 'POST', path: '/fbmain/monitor/v3/mp_estimated_metrics' },
  { key: 'searchMpsBySubject', label: '主体名下公众号搜索', method: 'POST', path: '/fbmain/monitor/v3/search_mps_by_subject' },
  { key: 'searchMpByKeyword', label: '根据关键字查询公众号', method: 'POST', path: '/fbmain/monitor/v3/search_wechat' },
  { key: 'searchMpBySosuo', label: '搜一搜搜公众号', method: 'POST', path: '/fbmain/monitor/v3/sosuo_mp' },
  { key: 'getCategoryMpRankings', label: '获取指定类别公众号日榜周榜月榜', method: 'POST', path: '/fbmain/monitor/v3/mp_rankings' },
  { key: 'convertMpArticleUrl', label: '公众号文章链接长短互转', method: 'POST', path: '/fbmain/monitor/v3/convert_mp_article_url' },
  { key: 'convertSogouTempUrl', label: '搜狗临时链接转永久链接', method: 'POST', path: '/fbmain/monitor/v3/convert_sogou_temp_url' },
  { key: 'getApiBalance', label: '获取api余额', method: 'POST', path: '/fbmain/monitor/v3/api_balance' },
  { key: 'convertSogouArticleUrl', label: '搜狗搜索文章链接转永久链接', method: 'POST', path: '/fbmain/monitor/v3/convert_sogou_article_url' },
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
    throw new Error('DAJIALA_API_KEY 未配置');
  }

  const endpoint = DEFINITIONS.find((item) => item.key === key);
  if (!endpoint) {
    throw new Error(`未知接口: ${key}`);
  }

  const overrides = parseOverrides();
  const path = overrides[key] || endpoint.path;
  if (!path) {
    throw new Error(`接口未配置路径: ${key}`);
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
