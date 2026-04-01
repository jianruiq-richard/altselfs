import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInvestorOrNull } from '@/lib/investor-auth';

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
      return decodeURIComponent(match[1]).trim();
    }
  }

  return '';
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
  if (directBiz) {
    return {
      biz: directBiz,
      normalizedUrl: normalizeUrlWithoutHash(parsed.toString()),
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
    if (finalBiz) {
      return {
        biz: finalBiz,
        normalizedUrl: normalizeUrlWithoutHash(finalUrl.toString()),
      } as const;
    }

    const html = await res.text();
    const htmlBiz = extractBizFromText(html);
    if (htmlBiz) {
      return {
        biz: htmlBiz,
        normalizedUrl: normalizeUrlWithoutHash(finalUrl.toString()),
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

  let parsed:
    | {
        biz: string;
        normalizedUrl: string;
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

  const source = await prisma.investorWechatSource.create({
    data: {
      investorId: investor.id,
      biz: parsed.biz,
      displayName: candidateName || inferDisplayName(parsed.biz),
      lastArticleUrl: parsed.normalizedUrl || articleUrl || `https://mp.weixin.qq.com/?__biz=${encodeURIComponent(parsed.biz)}`,
    },
  });

  return NextResponse.json({ ok: true, source });
}
