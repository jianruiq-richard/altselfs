import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { isDajialaReady } from '@/lib/dajiala-tools/raw';
import { resolveWechatAccountsByKeyword } from '@/lib/dajiala-tools/agent';

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keyword = String(req.nextUrl.searchParams.get('keyword') || '').trim();
  if (!keyword) {
    return NextResponse.json({ error: '请输入关键词' }, { status: 400 });
  }

  if (!isDajialaReady()) {
    return NextResponse.json(
      { error: '第三方公众号搜索未配置（缺少 DAJIALA_API_KEY）' },
      { status: 400 }
    );
  }

  try {
    const candidates = await resolveWechatAccountsByKeyword(keyword);
    return NextResponse.json({ ok: true, candidates });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: `搜索失败：${detail}` }, { status: 500 });
  }
}
