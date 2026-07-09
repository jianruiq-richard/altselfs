import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

type PendingFeishuCliAuth = {
  state?: string;
  sessionId?: string;
  profileName?: string;
  expiresAt?: string | null;
  featurePackages?: string[];
};

type FeishuCliAdvanceResponse = {
  ok?: boolean;
  phase?: string;
  setupUrl?: string | null;
  authUrl?: string | null;
  userCode?: string | null;
  expiresAt?: string | null;
  authExpiresAt?: string | null;
  account?: unknown;
  error?: string;
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
  const body = await req.json().catch(() => ({})) as { action?: unknown };
  const action = body.action === 'complete' ? 'complete' : 'continue';
  const sessionId = typeof pending?.sessionId === 'string' ? pending.sessionId : '';
  const expiresAt = typeof pending?.expiresAt === 'string' ? pending.expiresAt : '';
  const featurePackages = Array.isArray(pending?.featurePackages) ? pending.featurePackages : [];
  if (!sessionId) {
    return NextResponse.json({ error: '飞书授权会话不存在或已过期，请重新绑定。' }, { status: 400 });
  }
  if (expiresAt && Date.parse(expiresAt) < Date.now()) {
    return NextResponse.json({ error: '飞书授权会话已过期，请重新绑定。' }, { status: 400 });
  }

  try {
    const path = action === 'complete'
      ? '/internal/personal-data/feishu-cli/complete'
      : '/internal/personal-data/feishu-cli/continue';
    const completed = await personalAgentInternalFetch<FeishuCliAdvanceResponse>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        userId: investor.email || investor.id,
        sessionId,
        featurePackages,
      }),
    });
    const res = NextResponse.json({ ok: true, ...completed });
    if (completed.phase === 'connected' || completed.account) {
      res.cookies.delete('oauth_state_personal_feishu_cli');
    }
    return res;
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : '飞书 CLI 授权流程失败，请确认已在飞书页面完成当前步骤。',
    }, { status: 500 });
  }
}
