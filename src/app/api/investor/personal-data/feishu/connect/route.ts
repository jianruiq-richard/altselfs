import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

type FeishuCliStartResponse = {
  ok?: boolean;
  authUrl?: string;
  deviceCode?: string;
  profileName?: string;
  expiresAt?: string | null;
  userCode?: string | null;
};

function encodeCookiePayload(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.redirect(new URL('/sign-in', req.url));

  const state = randomUUID();
  try {
    const started = await personalAgentInternalFetch<FeishuCliStartResponse>('/internal/personal-data/feishu-cli/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        userId: investor.email || investor.id,
      }),
    });
    if (!started.authUrl || !started.deviceCode || !started.profileName) {
      throw new Error('personal-agent-server did not return Feishu CLI auth session.');
    }
    const url = new URL('/investor/info-ops', req.url);
    url.searchParams.set('integrationProvider', 'feishu');
    url.searchParams.set('integrationStatus', 'pending');
    url.searchParams.set('integrationDetail', '请打开飞书授权链接完成授权，然后点击“完成绑定”。');
    url.searchParams.set('feishuAuthUrl', started.authUrl);
    if (started.userCode) url.searchParams.set('feishuUserCode', started.userCode);
    const res = NextResponse.redirect(url);
    res.cookies.set('oauth_state_personal_feishu_cli', encodeCookiePayload({
      state,
      profileName: started.profileName,
      deviceCode: started.deviceCode,
      expiresAt: started.expiresAt || null,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 15,
      path: '/',
    });
    return res;
  } catch (err) {
    const url = new URL('/investor/info-ops', req.url);
    url.searchParams.set('integrationProvider', 'feishu');
    url.searchParams.set('integrationStatus', 'error');
    url.searchParams.set('integrationDetail', err instanceof Error ? err.message : '飞书 CLI 授权启动失败');
    return NextResponse.redirect(url);
  }
}
