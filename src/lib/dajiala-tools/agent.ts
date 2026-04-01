import { DajialaRaw, isDajialaReady } from '@/lib/dajiala-tools/raw';

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
    displayName: pickString(item.name, item.nickname, item.account_name),
    wechatId: pickString(item.wxid, item.wechat_id, item.alias, item.account),
    biz: pickString(item.biz, item.__biz, item.fakeid),
    originId: pickString(item.origin_id, item.ghid, item.gh_id, item.ori_id),
    description: pickString(item.description, item.desc, item.intro, item.brief, item.signature),
    latestArticleUrl: '',
  };
}

export async function resolveWechatAccountsByKeyword(keyword: string) {
  const query = keyword.trim();
  if (!query) return [];
  if (!isDajialaReady()) {
    throw new Error('DAJIALA_API_KEY 未配置');
  }

  const [primary, fallback] = await Promise.all([
    DajialaRaw.searchMpByKeyword({ keyword: query, page: 1, limit: 20 }),
    DajialaRaw.searchMpBySosuo({ keyword: query, page: 1, limit: 20 }),
  ]);

  const raw = [...asList(primary), ...asList(fallback)];
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
        const posts = await DajialaRaw.getMpHistoryPosts(payload);
        const list = asList(posts);
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
  return DajialaRaw.getMpHistoryPosts({
    biz: input.biz,
    wxid: input.wechatId,
    name: input.name,
    origin_id: input.originId,
    p: input.page || 1,
    count: input.count || 20,
  });
}

export async function getArticleDetail(input: { url: string }) {
  return DajialaRaw.getArticleDetailTextRich({ url: input.url });
}

export async function getArticleMetrics(input: { url: string }) {
  return DajialaRaw.getArticleInfoBatch({ url: input.url });
}

export async function searchArticles(input: {
  keyword: string;
  page?: number;
  limit?: number;
}) {
  return DajialaRaw.searchWechatArticlesDatabase({
    keyword: input.keyword,
    page: input.page || 1,
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
  const fn = mode === 2 ? DajialaRaw.searchWechatRealtimeMode2 : DajialaRaw.searchWechatRealtimeMode1;
  return fn({
    keyword: input.keyword,
    page: input.page || 1,
    limit: input.limit || 20,
  });
}

export async function convertArticleUrl(input: { url: string }) {
  return DajialaRaw.convertMpArticleUrl({ url: input.url });
}
