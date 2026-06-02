import { SignUp } from '@clerk/nextjs';
import { headers } from 'next/headers';
import Link from 'next/link';
import { EmbeddedBrowserAuthGuard } from '@/components/embedded-browser-auth-guard';
import { clerkAuthAppearance } from '@/lib/clerk-auth-appearance';
import { isOauthBlockedEmbeddedBrowser } from '@/lib/oauth-browser';

function buildFallbackUrl(path: string, headersList: Headers): string {
  const protocol = headersList.get('x-forwarded-proto') ?? 'https';
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host') ?? 'altselfs.com';

  return `${protocol}://${host}${path}`;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; method?: string }>;
}) {
  const params = await searchParams;
  const headersList = await headers();
  const method = params.method === 'email' ? 'email' : 'phone';
  const baseSignUpUrl = '/sign-up';
  const methodJoiner = baseSignUpUrl.includes('?') ? '&' : '?';
  const redirectUrl = '/dashboard';
  const fallbackUrl = buildFallbackUrl(`${baseSignUpUrl}${methodJoiner}method=${method}`, headersList);
  const isEmbeddedBrowser = isOauthBlockedEmbeddedBrowser(headersList.get('user-agent'));

  return (
    <div className="flex min-h-svh items-start justify-center overflow-x-hidden bg-gray-50 px-4 py-8 sm:items-center sm:py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">注册 OPC 账户</h1>
          <p className="text-gray-600 mt-2">完成注册后将进入数字分身工作台</p>
          <p className="text-xs text-gray-500 mt-2">支持邮箱、Google、手机号验证码注册</p>
        </div>
        <div className="mb-4 flex gap-2">
          <Link
            href={`${baseSignUpUrl}${methodJoiner}method=phone`}
            className={`flex-1 text-center py-2 rounded-lg border text-sm font-medium transition-colors ${
              method === 'phone'
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            手机号注册
          </Link>
          <Link
            href={`${baseSignUpUrl}${methodJoiner}method=email`}
            className={`flex-1 text-center py-2 rounded-lg border text-sm font-medium transition-colors ${
              method === 'email'
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            邮箱注册
          </Link>
        </div>
        <EmbeddedBrowserAuthGuard
          fallbackUrl={fallbackUrl}
          initiallyBlocked={isEmbeddedBrowser}
          mode="sign-up"
        >
          <SignUp
            key={method}
            forceRedirectUrl={redirectUrl}
            fallbackRedirectUrl={redirectUrl}
            initialValues={method === 'phone' ? { phoneNumber: '+86' } : { emailAddress: '' }}
            appearance={clerkAuthAppearance}
          />
        </EmbeddedBrowserAuthGuard>
      </div>
    </div>
  );
}
