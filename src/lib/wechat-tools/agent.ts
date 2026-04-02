import { isWechatProviderReady, WechatProviderRaw } from '@/lib/wechat-data-provider/raw';

type AnyRecord = Record<string, unknown>;

export type AggregatedWechatAccount = {
  displayName: string;
  wechatId: string;
  biz: string;
  originId: string;
  description: string;
  latestArticleUrl: string;
};

function asList(payload: AnyRecord | null | undefined): AnyRecord[] {
  if (!payload) return [];
  const data = payload.data;
  if (Array.isArray(data)) return data as AnyRecord[];
  if (data && typeof data === 'object') {
    const d = data as AnyRecord;
    if (Array.isArray(d.list)) return d.list as AnyRecord[];
    if (Array.isArray(d.rows)) return d.rows as AnyRecord[];
    if (Array.isArray(d.items)) return d.items as AnyRecord[];
  }
  if (Array.isArray(payload.list)) return payload.list as AnyRecord[];
  if (Array.isArray(payload.rows)) return payload.rows as AnyRecord[];
  if (Array.isArray(payload.items)) return payload.items as AnyRecord[];
  return [];
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function normalizeAccount(item: AnyRecord): AggregatedWechatAccount {
  return {
    displayName: pickString(item.wx_name, item.nick_name, item.nickname, item.name, item.account_name),
    wechatId: pickString(item.wx_id, item.wxid, item.wechat_id, item.alias, item.account),
    biz: pickString(item.wx_biz, item.biz, item.__biz, item.fakeid),
    originId: pickString(item.wx_user, item.origin_id, item.ghid, item.gh_id, item.ori_id),
    description: pickString(item.signature, item.desc, item.description, item.intro, item.brief),
    latestArticleUrl: '',
  };
}

export async function resolveWechatAccountsByKeyword(keyword: string) {
  const query = keyword.trim();
  if (!query) return [];
  if (!isWechatProviderReady()) {
    throw new Error('微信公众号数据源未配置');
  }

  const primary = await WechatProviderRaw.searchMpByKeyword({
    keyword: query,
    page: 1,
    limit: 20,
  }).catch(() => null);
  const fallback = await WechatProviderRaw.searchMpBySosuo({
    keyword: query,
    page: 1,
    limit: 20,
  }).catch(() => null);

  const raw = [...asList(primary as AnyRecord), ...asList(fallback as AnyRecord)];
  const dedup = new Map<string, AggregatedWechatAccount>();
  for (const item of raw) {
    const normalized = normalizeAccount(item);
    const key = normalized.biz || normalized.originId || normalized.wechatId || normalized.displayName;
    if (!key || dedup.has(key)) continue;
    dedup.set(key, normalized);
  }

  const top = [...dedup.values()].slice(0, 20);
  const withLatest = await Promise.all(
    top.map(async (account) => {
      const paramsCandidates: AnyRecord[] = [
        { biz: account.biz, p: 1, count: 3 },
        { wxid: account.wechatId, p: 1, count: 3 },
        { name: account.displayName, p: 1, count: 3 },
        { origin_id: account.originId, p: 1, count: 3 },
      ];
      for (const params of paramsCandidates) {
        const payload = Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== null && String(v).trim())
        );
        if (Object.keys(payload).length < 3) continue;
        const posts = await WechatProviderRaw.getMpHistoryPosts(payload).catch(() => null);
        if (!posts) continue;
        const list = asList(posts as AnyRecord);
        const first = list[0] || {};
        const url = pickString(
          (first as AnyRecord).url,
          (first as AnyRecord).article_url,
          (first as AnyRecord).content_url,
          (first as AnyRecord).link
        );
        if (url) {
          return { ...account, latestArticleUrl: url };
        }
      }
      return account;
    })
  );

  return withLatest;
}

export async function listArticlesByAccount(input: {
  biz?: string;
  wechatId?: string;
  name?: string;
  originId?: string;
  page?: number;
  count?: number;
}) {
  return WechatProviderRaw.getMpHistoryPosts({
    biz: input.biz,
    wxid: input.wechatId,
    name: input.name,
    origin_id: input.originId,
    p: input.page || 1,
    count: input.count || 20,
  });
}

export async function getArticleDetail(input: { url: string }) {
  return WechatProviderRaw.getArticleDetailTextRich({ url: input.url });
}

export async function getArticleMetrics(input: { url: string }) {
  return WechatProviderRaw.getArticleInfoBatch({ url: input.url });
}

export async function getArticleComments(input: {
  commentId: string;
  buffer?: string;
  contentId?: string;
  maxReplyId?: string;
  offset?: number;
}) {
  return WechatProviderRaw.getArticleComments({
    comment_id: input.commentId,
    buffer: input.buffer,
    content_id: input.contentId,
    max_reply_id: input.maxReplyId,
    offset: input.offset,
  });
}

export async function searchArticles(input: {
  keyword: string;
  page?: number;
  limit?: number;
}) {
  return WechatProviderRaw.searchWechatArticlesDatabase({
    keyword: input.keyword,
    page: input.page || 1,
    sort_type: 0,
    limit: input.limit || 20,
  });
}

export async function searchRealtimeArticles(input: {
  keyword: string;
  mode?: 1 | 2;
  page?: number;
  limit?: number;
}) {
  const mode = input.mode || 1;
  const fn =
    mode === 2
      ? WechatProviderRaw.searchWechatRealtimeMode2
      : WechatProviderRaw.searchWechatRealtimeMode1;
  return fn({
    keyword: input.keyword,
    page: input.page || 1,
    sort_type: mode === 2 ? 4 : 2,
    limit: input.limit || 20,
  });
}

export async function convertArticleUrl(input: { url: string }) {
  return WechatProviderRaw.convertMpArticleUrl({ url: input.url });
}
