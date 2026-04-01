import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { DajialaRaw, isDajialaReady } from '@/lib/dajiala-tools/raw';

function isValidBiz(value: string) {
  const biz = value.trim();
  if (!biz) return false;
  if (biz.includes('${') || biz.includes('window.') || biz.includes('{') || biz.includes('}')) return false;
  // WeChat biz is typically base64-like, often starts with Mz*
  return /^(Mz[A-Za-z0-9+/_=-]{8,}|[A-Za-z0-9+/_=-]{12,})$/.test(biz);
}

function normalizeUrlWithoutHash(input: string) {
  const url = new URL(input);
  url.hash = '';
  return url.toString();
}

function extractBizFromText(text: string) {
  const patterns = [
    /[?&]__biz=([^&"'\s]+)/i,
    /"__biz"\s*:\s*"([^"]+)"/i,
    /var\s+biz\s*=\s*"([^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const decoded = decodeURIComponent(match[1]).trim();
      if (isValidBiz(decoded)) {
        return decoded;
      }
    }
  }

  return '';
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractProfileFromHtml(html: string) {
  const nicknameCandidates = [
    html.match(/var\s+nickname\s*=\s*'([^']+)'/i)?.[1],
    html.match(/var\s+nickname\s*=\s*"([^"]+)"/i)?.[1],
    html.match(/"nickname"\s*:\s*"([^"]+)"/i)?.[1],
    html.match(/meta property="og:article:author" content="([^"]+)"/i)?.[1],
  ].filter(Boolean) as string[];

  const descCandidates = [
    html.match(/var\s+user_desc\s*=\s*'([^']+)'/i)?.[1],
    html.match(/var\s+user_desc\s*=\s*"([^"]+)"/i)?.[1],
    html.match(/"user_desc"\s*:\s*"([^"]+)"/i)?.[1],
  ].filter(Boolean) as string[];

  return {
    displayName: decodeHtmlEntities((nicknameCandidates[0] || '').trim()),
    description: decodeHtmlEntities((descCandidates[0] || '').trim()),
  };
}

async function parseWechatArticleUrl(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: '请输入有效的文章链接' } as const;
  }

  if (!['mp.weixin.qq.com', 'weixin.qq.com'].includes(parsed.hostname)) {
    return { error: '仅支持微信公众平台文章链接' } as const;
  }

  const directBiz = (parsed.searchParams.get('__biz') || '').trim();
  if (directBiz && isValidBiz(directBiz)) {
    let displayName = '';
    let description = '';
    try {
      const page = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        },
        signal: AbortSignal.timeout(10_000),
      });
      const html = await page.text();
      const profile = extractProfileFromHtml(html);
      displayName = profile.displayName;
      description = profile.description;
    } catch {
      // ignore profile extraction errors
    }

    return {
      biz: directBiz,
      normalizedUrl: normalizeUrlWithoutHash(parsed.toString()),
      displayName,
      description,
    } as const;
  }

  try {
    // 兼容短链：先跟随跳转拿最终URL，再从URL或HTML中提取 __biz
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
      signal: AbortSignal.timeout(10_000),
    });

    const finalUrl = new URL(res.url || parsed.toString());
    const finalBiz = (finalUrl.searchParams.get('__biz') || '').trim();
    if (finalBiz && isValidBiz(finalBiz)) {
      return {
        biz: finalBiz,
        normalizedUrl: normalizeUrlWithoutHash(finalUrl.toString()),
      } as const;
    }

    const html = await res.text();
    const profile = extractProfileFromHtml(html);
    const htmlBiz = extractBizFromText(html);
    if (htmlBiz) {
      return {
        biz: htmlBiz,
        normalizedUrl: normalizeUrlWithoutHash(finalUrl.toString()),
        displayName: profile.displayName,
        description: profile.description,
      } as const;
    }
  } catch {
    // 网络/超时失败时走统一报错
  }

  return { error: '未识别到公众号标识（__biz），请确认是有效的公众号文章链接' } as const;
}

function inferDisplayName(biz: string) {
  const suffix = biz.length > 8 ? biz.slice(-8) : biz;
  return `公众号-${suffix}`;
}

type AnyRecord = Record<string, unknown>;
type EnrichLog = {
  step: string;
  status: 'ok' | 'skip' | 'error';
  detail?: string;
  input?: Record<string, unknown>;
};

function pickString(obj: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function asList(payload: unknown): AnyRecord[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as AnyRecord;
  if (Array.isArray(root.data)) return root.data as AnyRecord[];
  if (root.data && typeof root.data === 'object') {
    const data = root.data as AnyRecord;
    if (Array.isArray(data.list)) return data.list as AnyRecord[];
    if (Array.isArray(data.rows)) return data.rows as AnyRecord[];
    if (Array.isArray(data.items)) return data.items as AnyRecord[];
  }
  if (Array.isArray(root.list)) return root.list as AnyRecord[];
  if (Array.isArray(root.rows)) return root.rows as AnyRecord[];
  if (Array.isArray(root.items)) return root.items as AnyRecord[];
  return [];
}

async function enrichFromDajialaByBiz(biz: string, hintUrl?: string) {
  const logs: EnrichLog[] = [];
  if (!isDajialaReady()) {
    logs.push({
      step: 'dajiala_config_check',
      status: 'skip',
      detail: 'DAJIALA_API_KEY 未配置',
    });
    return { displayName: '', description: '', latestArticleUrl: '', logs };
  }

  try {
    let displayName = '';
    let description = '';
    let latestArticleUrl = '';

    try {
      const principal = await DajialaRaw.getMpSubjectInfo({
        biz,
        url: latestArticleUrl || hintUrl || undefined,
      });
      logs.push({
        step: 'getMpSubjectInfo',
        status: 'ok',
        input: { biz, url: latestArticleUrl || hintUrl || undefined },
      });
      const principalObj =
        (principal && typeof principal === 'object' && (principal as AnyRecord).data && typeof (principal as AnyRecord).data === 'object'
          ? ((principal as AnyRecord).data as AnyRecord)
          : (principal as AnyRecord)) || {};
      displayName =
        pickString(principalObj, ['nick_name', 'nickname', 'name', 'account_name', 'wx_name']) || displayName;
      description =
        pickString(principalObj, ['desc', 'description', 'intro', 'brief', 'signature']) || description;
    } catch (error) {
      logs.push({
        step: 'getMpSubjectInfo',
        status: 'error',
        detail: error instanceof Error ? error.message : 'unknown',
        input: { biz, url: latestArticleUrl || hintUrl || undefined },
      });
    }

    if (!displayName) {
      try {
        const base = await DajialaRaw.getMpBaseInfo({
          url: latestArticleUrl || hintUrl || undefined,
        });
        logs.push({
          step: 'getMpBaseInfo',
          status: 'ok',
          input: { url: latestArticleUrl || hintUrl || undefined },
        });
        const baseObj =
          (base && typeof base === 'object' && (base as AnyRecord).data && typeof (base as AnyRecord).data === 'object'
            ? ((base as AnyRecord).data as AnyRecord)
            : (base as AnyRecord)) || {};
        displayName =
          pickString(baseObj, ['nick_name', 'nickname', 'name', 'account_name', 'wx_name']) || displayName;
        description =
          pickString(baseObj, ['desc', 'description', 'intro', 'brief', 'signature']) || description;
      } catch (error) {
        logs.push({
          step: 'getMpBaseInfo',
          status: 'error',
          detail: error instanceof Error ? error.message : 'unknown',
          input: { url: latestArticleUrl || hintUrl || undefined },
        });
      }
    }

    if (!latestArticleUrl && !hintUrl) {
      try {
        const history = await DajialaRaw.getMpHistoryPosts({ biz, p: 1, count: 3 });
        logs.push({
          step: 'getMpHistoryPosts',
          status: 'ok',
          input: { biz, p: 1, count: 3 },
        });
        const list = asList(history);
        const first = list[0] || {};
        latestArticleUrl = pickString(first, ['url', 'article_url', 'content_url', 'link']);
      } catch (error) {
        logs.push({
          step: 'getMpHistoryPosts',
          status: 'error',
          detail: error instanceof Error ? error.message : 'unknown',
          input: { biz, p: 1, count: 3 },
        });
      }
    } else {
      logs.push({
        step: 'getMpHistoryPosts',
        status: 'skip',
        detail: '已有文章链接，无需补抓历史',
      });
    }

    return { displayName, description, latestArticleUrl, logs };
  } catch {
    logs.push({
      step: 'enrichFromDajialaByBiz',
      status: 'error',
      detail: 'unexpected error',
    });
    return { displayName: '', description: '', latestArticleUrl: '', logs };
  }
}

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sources = await prisma.investorWechatSource.findMany({
    where: { investorId: investor.id },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const articleUrl = String((body as { articleUrl?: string })?.articleUrl || '').trim();
  const candidateBiz = String((body as { biz?: string })?.biz || '').trim();
  const candidateName = String((body as { displayName?: string })?.displayName || '').trim();
  const candidateDescription = String((body as { description?: string })?.description || '').trim();

  let parsed:
    | {
        biz: string;
        normalizedUrl: string;
        displayName?: string;
        description?: string;
      }
    | { error: string };

  if (articleUrl) {
    parsed = await parseWechatArticleUrl(articleUrl);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
  } else {
    if (!candidateBiz) {
      return NextResponse.json({ error: '请先输入文章链接，或从候选公众号中选择后添加' }, { status: 400 });
    }
    if (!isValidBiz(candidateBiz)) {
      return NextResponse.json({ error: '候选公众号标识无效，请重新搜索并选择' }, { status: 400 });
    }
    parsed = {
      biz: candidateBiz,
      normalizedUrl: '',
    };
  }

  const existing = await prisma.investorWechatSource.findUnique({
    where: {
      investorId_biz: {
        investorId: investor.id,
        biz: parsed.biz,
      },
    },
  });

  if (existing) {
    return NextResponse.json(
      {
        error: '该公众号已存在，请勿重复录入',
        source: existing,
      },
      { status: 409 }
    );
  }

  const enriched = await enrichFromDajialaByBiz(parsed.biz, articleUrl || parsed.normalizedUrl || undefined);
  const source = await prisma.investorWechatSource.create({
    data: {
      investorId: investor.id,
      biz: parsed.biz,
      displayName:
        candidateName ||
        parsed.displayName ||
        enriched.displayName ||
        inferDisplayName(parsed.biz),
      description: candidateDescription || parsed.description || enriched.description || null,
      lastArticleUrl:
        enriched.latestArticleUrl ||
        articleUrl ||
        parsed.normalizedUrl ||
        `https://mp.weixin.qq.com/?__biz=${encodeURIComponent(parsed.biz)}`,
    },
  });

  return NextResponse.json({ ok: true, source, logs: enriched.logs });
}
