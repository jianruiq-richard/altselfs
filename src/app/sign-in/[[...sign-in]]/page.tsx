import { SignIn } from '@clerk/nextjs';
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

export default async function Page() {
  const headersList = await headers();
  const fallbackUrl = buildFallbackUrl('/sign-in', headersList);
  const isEmbeddedBrowser = isOauthBlockedEmbeddedBrowser(headersList.get('user-agent'));

  return (
    <div className="flex min-h-svh items-start justify-center overflow-x-hidden bg-gray-50 px-4 py-8 sm:items-center sm:py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">欢迎回来</h1>
          <p className="text-gray-600 mt-2">登录到 OPC 平台（支持邮箱、Google、手机号验证码）</p>
        </div>
        <EmbeddedBrowserAuthGuard
          fallbackUrl={fallbackUrl}
          initiallyBlocked={isEmbeddedBrowser}
          mode="sign-in"
        >
          <SignIn
            forceRedirectUrl="/dashboard"
            fallbackRedirectUrl="/dashboard"
            appearance={clerkAuthAppearance}
          />
        </EmbeddedBrowserAuthGuard>
        <div className="mt-4 text-sm text-center text-gray-600">
          还没账号？
          <Link href="/sign-up?method=phone" className="text-blue-600 hover:underline ml-1">
            注册 OPC 账户
          </Link>
        </div>
      </div>
    </div>
  );
}
