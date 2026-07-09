import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

type PendingFeishuCliAuth = {
  state?: string;
  profileName?: string;
  deviceCode?: string;
  expiresAt?: string | null;
  featurePackages?: string[];
};

function decodeCookiePayload(value: string): PendingFeishuCliAuth | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as PendingFeishuCliAuth : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pending = decodeCookiePayload(req.cookies.get('oauth_state_personal_feishu_cli')?.value || '');
  const profileName = typeof pending?.profileName === 'string' ? pending.profileName : '';
  const deviceCode = typeof pending?.deviceCode === 'string' ? pending.deviceCode : '';
  const expiresAt = typeof pending?.expiresAt === 'string' ? pending.expiresAt : '';
  const featurePackages = Array.isArray(pending?.featurePackages) ? pending.featurePackages : [];
  if (!profileName || !deviceCode) {
    return NextResponse.json({ error: '飞书授权会话不存在或已过期，请重新绑定。' }, { status: 400 });
  }
  if (expiresAt && Date.parse(expiresAt) < Date.now()) {
    return NextResponse.json({ error: '飞书授权会话已过期，请重新绑定。' }, { status: 400 });
  }

  try {
    const completed = await personalAgentInternalFetch('/internal/personal-data/feishu-cli/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        userId: investor.email || investor.id,
        profileName,
        deviceCode,
        featurePackages,
      }),
    });
    const res = NextResponse.json({ ok: true, ...completed });
    res.cookies.delete('oauth_state_personal_feishu_cli');
    return res;
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : '飞书 CLI 授权完成失败，请确认已在飞书页面点授权。',
    }, { status: 500 });
  }
}
