type HttpMethod = 'GET' | 'POST';
type AnyRecord = Record<string, unknown>;

export type WxrankEndpointKey =
  | 'searchMpByKeyword'
  | 'searchMpBySosuo'
  | 'getMpHistoryPosts'
  | 'getMpSubjectInfo'
  | 'getMpBaseInfo'
  | 'getArticleDetailTextRich'
  | 'getArticleInfoBatch'
  | 'getArticleComments'
  | 'searchWechatArticlesDatabase'
  | 'searchWechatRealtimeMode1'
  | 'searchWechatRealtimeMode2'
  | 'convertMpArticleUrl';

type EndpointDefinition = {
  key: WxrankEndpointKey;
  label: string;
  method: HttpMethod;
  defaultPath: string;
};

const DEFAULT_BASE_URL = process.env.WXRANK_BASE_URL || 'http://data.wxrank.com';
const API_KEY = process.env.WXRANK_API_KEY || '';
const AUTH_MODE = (process.env.WXRANK_AUTH_MODE || 'body').toLowerCase();
const AUTH_HEADER = process.env.WXRANK_AUTH_HEADER || 'X-API-KEY';
const AUTH_FIELD = process.env.WXRANK_AUTH_FIELD || 'key';

const DEFINITIONS: EndpointDefinition[] = [
  { key: 'searchMpByKeyword', label: '关键词搜索公众号', method: 'POST', defaultPath: '/weixin/getsu' },
  { key: 'searchMpBySosuo', label: '搜一搜搜公众号', method: 'POST', defaultPath: '/weixin/getsu' },
  { key: 'getMpHistoryPosts', label: '获取公众号历史发文列表', method: 'POST', defaultPath: '/weixin/getpc' },
  { key: 'getMpSubjectInfo', label: '获取公众号主体信息', method: 'POST', defaultPath: '/weixin/getinfo' },
  { key: 'getMpBaseInfo', label: '获取公众号基础信息', method: 'POST', defaultPath: '/weixin/getbiz' },
  { key: 'getArticleDetailTextRich', label: '获取文章详情（正文）', method: 'POST', defaultPath: '/weixin/artinfo' },
  { key: 'getArticleInfoBatch', label: '获取文章指标/信息', method: 'POST', defaultPath: '/weixin/getrk' },
  { key: 'getArticleComments', label: '获取文章留言列表', method: 'POST', defaultPath: '/weixin/getcm' },
  { key: 'searchWechatArticlesDatabase', label: '搜索微信文章（数据库）', method: 'POST', defaultPath: '/weixin/getso' },
  { key: 'searchWechatRealtimeMode1', label: '微信搜一搜实时搜文章 mode1', method: 'POST', defaultPath: '/weixin/getso' },
  { key: 'searchWechatRealtimeMode2', label: '微信搜一搜实时搜文章 mode2', method: 'POST', defaultPath: '/weixin/getso' },
  { key: 'convertMpArticleUrl', label: '公众号文章链接转换', method: 'POST', defaultPath: '/weixin/artinfo' },
];

function parseOverrides() {
  const raw = process.env.WXRANK_ENDPOINT_OVERRIDES;
  if (!raw) return {} as Partial<Record<WxrankEndpointKey, string>>;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed as Partial<Record<WxrankEndpointKey, string>>;
  } catch {
    return {} as Partial<Record<WxrankEndpointKey, string>>;
  }
}

function appendAuthToParams(params: AnyRecord) {
  if (AUTH_MODE === 'body' || AUTH_MODE === 'query') {
    return {
      [AUTH_FIELD]: API_KEY,
      ...params,
    };
  }
  return params;
}

function buildHeaders() {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (AUTH_MODE === 'header') {
    headers[AUTH_HEADER] = API_KEY;
  }
  return headers;
}

function buildQuery(params: AnyRecord) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const next = String(value).trim();
    if (!next) continue;
    query.set(key, next);
  }
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

export function isWxrankReady() {
  return Boolean(API_KEY.trim());
}

export function listWxrankEndpointDefinitions() {
  return DEFINITIONS;
}

export async function callWxrankEndpoint(key: WxrankEndpointKey, params: AnyRecord = {}) {
  if (!isWxrankReady()) {
    throw new Error('WXRANK_API_KEY 未配置');
  }

  const endpoint = DEFINITIONS.find((item) => item.key === key);
  if (!endpoint) {
    throw new Error(`未知 wxrank 接口: ${key}`);
  }

  const overrides = parseOverrides();
  const path = overrides[key] || endpoint.defaultPath;
  if (!path) {
    throw new Error(`WXRANK_ENDPOINT_OVERRIDES 缺少接口路径: ${key}`);
  }

  const authParams = appendAuthToParams(params);
  const url = `${DEFAULT_BASE_URL}${path}`;

  if (endpoint.method === 'GET') {
    const query = buildQuery(
      AUTH_MODE === 'query' ? authParams : params
    );
    const res = await fetch(query ? `${url}?${query}` : url, {
      method: 'GET',
      headers: AUTH_MODE === 'header' ? buildHeaders() : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    return parseResponseSafe(res);
  }

  const bodyPayload = AUTH_MODE === 'query' ? params : authParams;
  const finalUrl =
    AUTH_MODE === 'query'
      ? (() => {
          const query = buildQuery({ [AUTH_FIELD]: API_KEY });
          return query ? `${url}?${query}` : url;
        })()
      : url;

  const res = await fetch(finalUrl, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(15_000),
  });
  return parseResponseSafe(res);
}

export const WxrankRaw = {
  searchMpByKeyword: (params: AnyRecord) =>
    callWxrankEndpoint('searchMpByKeyword', {
      keyword: params.keyword,
      page: params.page,
    }),
  searchMpBySosuo: (params: AnyRecord) =>
    callWxrankEndpoint('searchMpBySosuo', {
      keyword: params.keyword,
      page: params.page,
    }),
  getMpHistoryPosts: async (params: AnyRecord) => {
    const biz = typeof params.biz === 'string' ? params.biz.trim() : '';
    const wxidRaw =
      (typeof params.wxid === 'string' && params.wxid.trim()) ||
      (typeof params.origin_id === 'string' && params.origin_id.trim()) ||
      '';
    const count = Math.max(1, Math.min(20, Number(params.count) || 10));
    if (biz) {
      const begin = Number(params.begin) || 0;
      const payload = await callWxrankEndpoint('getMpHistoryPosts', { biz, begin });
      const root = (payload || {}) as AnyRecord;
      const data = (root.data || {}) as AnyRecord;
      const publishList = Array.isArray(data.publish_list)
        ? (data.publish_list as AnyRecord[])
        : [];
      const list: AnyRecord[] = [];
      for (const block of publishList) {
        const sentTime = typeof block.sent_info_time === 'string' ? block.sent_info_time : '';
        const appList = Array.isArray(block.sent_appmsg_list)
          ? (block.sent_appmsg_list as AnyRecord[])
          : [];
        for (const item of appList) {
          list.push({
            title: item.title,
            url: item.art_url,
            article_url: item.art_url,
            pic_url: item.pic_url,
            idx: item.idx,
            publish_time: sentTime,
            pub_time: sentTime,
            source: 'getpc',
          });
        }
      }
      return {
        ...root,
        data: {
          ...(typeof root.data === 'object' && root.data ? (root.data as AnyRecord) : {}),
          list: list.slice(0, count),
        },
      };
    }

    if (wxidRaw) {
      const payload = await callWxrankEndpoint('getMpHistoryPosts', {
        wxid: wxidRaw,
        cursor: typeof params.cursor === 'string' ? params.cursor : '',
      });
      const root = (payload || {}) as AnyRecord;
      const data = (root.data || {}) as AnyRecord;
      const list = Array.isArray(data.list) ? (data.list as AnyRecord[]) : [];
      return {
        ...root,
        data: {
          ...data,
          list: list.slice(0, count).map((item) => ({
            title: item.title,
            url: item.art_url,
            article_url: item.art_url,
            pic_url: item.pic_url,
            sn: item.sn,
            publish_time: item.pub_time,
            pub_time: item.pub_time,
            source: 'getps',
          })),
        },
      };
    }

    return {
      code: 1001,
      msg: 'biz 或 wxid 不能为空',
      data: { list: [] },
    };
  },
  getMpSubjectInfo: (params: AnyRecord) =>
    callWxrankEndpoint('getMpSubjectInfo', { biz: params.biz }),
  getMpBaseInfo: (params: AnyRecord) =>
    callWxrankEndpoint('getMpBaseInfo', { biz: params.biz }),
  getArticleDetailTextRich: (params: AnyRecord) =>
    callWxrankEndpoint('getArticleDetailTextRich', { url: params.url }),
  getArticleInfoBatch: (params: AnyRecord) =>
    callWxrankEndpoint('getArticleInfoBatch', {
      url: params.url,
      comment_id: params.comment_id,
    }),
  getArticleComments: (params: AnyRecord) =>
    callWxrankEndpoint('getArticleComments', {
      comment_id: params.comment_id,
      buffer: params.buffer,
      content_id: params.content_id,
      max_reply_id: params.max_reply_id,
      offset: params.offset,
    }),
  searchWechatArticlesDatabase: (params: AnyRecord) =>
    callWxrankEndpoint('searchWechatArticlesDatabase', {
      keyword: params.keyword,
      page: params.page,
      sort_type: params.sort_type,
    }),
  searchWechatRealtimeMode1: (params: AnyRecord) =>
    callWxrankEndpoint('searchWechatRealtimeMode1', {
      keyword: params.keyword,
      page: params.page,
      sort_type: 2,
    }),
  searchWechatRealtimeMode2: (params: AnyRecord) =>
    callWxrankEndpoint('searchWechatRealtimeMode2', {
      keyword: params.keyword,
      page: params.page,
      sort_type: 4,
    }),
  convertMpArticleUrl: async (params: AnyRecord) => {
    const payload = await callWxrankEndpoint('convertMpArticleUrl', { url: params.url });
    const root = (payload || {}) as AnyRecord;
    const data = (root.data || {}) as AnyRecord;
    return {
      ...root,
      data: {
        ...data,
        long_url: data.article_url,
        short_link: data.short_link,
      },
    };
  },
};
