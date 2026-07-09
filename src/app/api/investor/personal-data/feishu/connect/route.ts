import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';

type FeishuCliStartResponse = {
  ok?: boolean;
  phase?: string;
  sessionId?: string;
  setupUrl?: string | null;
  profileName?: string;
  expiresAt?: string | null;
  requestedFeaturePackages?: string[];
};

const FEISHU_FEATURE_PACKAGES = ['messages', 'contacts', 'calendar', 'docs', 'meetings'] as const;
const DEFAULT_FEISHU_FEATURE_PACKAGES = ['messages', 'contacts', 'calendar', 'docs'];

function encodeCookiePayload(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function readFeaturePackages(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('packages') || '';
  const allowed = new Set<string>(FEISHU_FEATURE_PACKAGES);
  const packages = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item, index, items) => allowed.has(item) && items.indexOf(item) === index);
  return packages.length > 0 ? packages : DEFAULT_FEISHU_FEATURE_PACKAGES;
}

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.redirect(new URL('/sign-in', req.url));

  const state = randomUUID();
  const featurePackages = readFeaturePackages(req);
  try {
    const started = await personalAgentInternalFetch<FeishuCliStartResponse>('/internal/personal-data/feishu-cli/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        investorId: investor.id,
        userId: investor.email || investor.id,
        featurePackages,
      }),
    });
    if (!started.sessionId || !started.setupUrl || !started.profileName) {
      throw new Error('personal-agent-server did not return Feishu CLI setup session.');
    }
    const url = new URL('/investor/info-ops', req.url);
    url.searchParams.set('integrationProvider', 'feishu');
    url.searchParams.set('integrationStatus', 'pending');
    url.searchParams.set('integrationDetail', '请先打开飞书 CLI 应用配置链接，完成后回到这里继续账号授权。');
    url.searchParams.set('feishuPhase', 'app_setup');
    url.searchParams.set('feishuSetupUrl', started.setupUrl);
    const res = NextResponse.redirect(url);
    res.cookies.set('oauth_state_personal_feishu_cli', encodeCookiePayload({
      state,
      sessionId: started.sessionId,
      profileName: started.profileName,
      expiresAt: started.expiresAt || null,
      featurePackages: started.requestedFeaturePackages || featurePackages,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 30,
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
