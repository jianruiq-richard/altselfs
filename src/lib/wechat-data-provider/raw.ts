import { DajialaRaw, isDajialaReady } from '@/lib/dajiala-tools/raw';
import { WxrankRaw, isWxrankReady } from '@/lib/wxrank-tools/raw';

type AnyRecord = Record<string, unknown>;

export type WechatDataProvider = 'wxrank' | 'dajiala';

type ProviderRaw = {
  searchMpByKeyword: (params: AnyRecord) => Promise<unknown>;
  searchMpBySosuo: (params: AnyRecord) => Promise<unknown>;
  getMpHistoryPosts: (params: AnyRecord) => Promise<unknown>;
  getMpSubjectInfo: (params: AnyRecord) => Promise<unknown>;
  getMpBaseInfo: (params: AnyRecord) => Promise<unknown>;
  getArticleDetailTextRich: (params: AnyRecord) => Promise<unknown>;
  getArticleInfoBatch: (params: AnyRecord) => Promise<unknown>;
  getArticleComments: (params: AnyRecord) => Promise<unknown>;
  searchWechatArticlesDatabase: (params: AnyRecord) => Promise<unknown>;
  searchWechatRealtimeMode1: (params: AnyRecord) => Promise<unknown>;
  searchWechatRealtimeMode2: (params: AnyRecord) => Promise<unknown>;
  convertMpArticleUrl: (params: AnyRecord) => Promise<unknown>;
};

export function getWechatDataProvider(): WechatDataProvider {
  const raw = String(process.env.WECHAT_DATA_PROVIDER || 'wxrank')
    .trim()
    .toLowerCase();
  return raw === 'dajiala' ? 'dajiala' : 'wxrank';
}

export function getWechatDataProviderLabel(provider = getWechatDataProvider()) {
  return provider === 'dajiala' ? 'dajiala' : 'wxrank';
}

export function getWechatProviderRequiredEnv(provider = getWechatDataProvider()) {
  return provider === 'dajiala' ? 'DAJIALA_API_KEY' : 'WXRANK_API_KEY';
}

export function isWechatProviderReady(provider = getWechatDataProvider()) {
  return provider === 'dajiala' ? isDajialaReady() : isWxrankReady();
}

function getProviderRaw(provider = getWechatDataProvider()): ProviderRaw {
  if (provider === 'dajiala') {
    return {
      searchMpByKeyword: DajialaRaw.searchMpByKeyword,
      searchMpBySosuo: DajialaRaw.searchMpBySosuo,
      getMpHistoryPosts: DajialaRaw.getMpHistoryPosts,
      getMpSubjectInfo: DajialaRaw.getMpSubjectInfo,
      getMpBaseInfo: DajialaRaw.getMpBaseInfo,
      getArticleDetailTextRich: DajialaRaw.getArticleDetailTextRich,
      getArticleInfoBatch: DajialaRaw.getArticleInfoBatch,
      getArticleComments: (params: AnyRecord) =>
        DajialaRaw.getArticleCommentsPro({
          comment_id: params.comment_id,
          url: params.url,
          buffer: params.buffer,
          content_id: params.content_id,
          max_reply_id: params.max_reply_id,
          offset: params.offset,
        }),
      searchWechatArticlesDatabase: DajialaRaw.searchWechatArticlesDatabase,
      searchWechatRealtimeMode1: DajialaRaw.searchWechatRealtimeMode1,
      searchWechatRealtimeMode2: DajialaRaw.searchWechatRealtimeMode2,
      convertMpArticleUrl: DajialaRaw.convertMpArticleUrl,
    };
  }
  return {
    searchMpByKeyword: WxrankRaw.searchMpByKeyword,
    searchMpBySosuo: WxrankRaw.searchMpBySosuo,
    getMpHistoryPosts: WxrankRaw.getMpHistoryPosts,
    getMpSubjectInfo: WxrankRaw.getMpSubjectInfo,
    getMpBaseInfo: WxrankRaw.getMpBaseInfo,
    getArticleDetailTextRich: WxrankRaw.getArticleDetailTextRich,
    getArticleInfoBatch: WxrankRaw.getArticleInfoBatch,
    getArticleComments: WxrankRaw.getArticleComments,
    searchWechatArticlesDatabase: WxrankRaw.searchWechatArticlesDatabase,
    searchWechatRealtimeMode1: WxrankRaw.searchWechatRealtimeMode1,
    searchWechatRealtimeMode2: WxrankRaw.searchWechatRealtimeMode2,
    convertMpArticleUrl: WxrankRaw.convertMpArticleUrl,
  };
}

async function call(method: keyof ProviderRaw, params: AnyRecord = {}, provider = getWechatDataProvider()) {
  const raw = getProviderRaw(provider);
  return raw[method](params);
}

export const WechatProviderRaw: ProviderRaw = {
  searchMpByKeyword: (params) => call('searchMpByKeyword', params),
  searchMpBySosuo: (params) => call('searchMpBySosuo', params),
  getMpHistoryPosts: (params) => call('getMpHistoryPosts', params),
  getMpSubjectInfo: (params) => call('getMpSubjectInfo', params),
  getMpBaseInfo: (params) => call('getMpBaseInfo', params),
  getArticleDetailTextRich: (params) => call('getArticleDetailTextRich', params),
  getArticleInfoBatch: (params) => call('getArticleInfoBatch', params),
  getArticleComments: (params) => call('getArticleComments', params),
  searchWechatArticlesDatabase: (params) => call('searchWechatArticlesDatabase', params),
  searchWechatRealtimeMode1: (params) => call('searchWechatRealtimeMode1', params),
  searchWechatRealtimeMode2: (params) => call('searchWechatRealtimeMode2', params),
  convertMpArticleUrl: (params) => call('convertMpArticleUrl', params),
};
