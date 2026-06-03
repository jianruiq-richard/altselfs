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
    <main className="relative min-h-svh overflow-hidden bg-[#efe7dc] px-4 py-6 sm:px-6 lg:px-8">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-75"
        style={{ backgroundImage: "url('/office.png')" }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(33,21,14,0.88)_0%,rgba(58,38,25,0.76)_46%,rgba(239,231,220,0.9)_100%)]" />

      <div className="relative mx-auto flex min-h-[calc(100svh-3rem)] max-w-6xl flex-col">
        <Link href="/" className="w-fit text-lg font-semibold tracking-wide text-[#fff8ee]">
          Altselfs
        </Link>

        <div className="grid flex-1 gap-10 py-10 lg:grid-cols-2 lg:items-center">
          <section className="max-w-xl text-[#fff8ee]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#f4c983]">
              Welcome back
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight sm:text-5xl sm:leading-tight">
              回到你的决策 OS
            </h1>
            <p className="mt-6 text-base leading-8 text-[#fff0dc]/82 sm:text-lg sm:leading-9">
              继续查看每日晨报、重要事项判断，以及正在沉淀的个人决策偏好。
            </p>
          </section>

          <section className="flex justify-center lg:justify-end">
            <div className="w-full max-w-md rounded-2xl border border-[#ead8bd] bg-[#fffaf2] p-5 shadow-2xl shadow-black/20 sm:p-7">
              <div className="mb-6 text-center">
                <h1 className="text-2xl font-semibold text-stone-950">欢迎回来</h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  登录 Altselfs，继续使用你的 Decision OS
                </p>
                <p className="mt-1 text-xs text-stone-500">支持邮箱、Google、手机号验证码登录</p>
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
              <div className="mt-4 text-center text-sm text-stone-600">
                还没账号？
                <Link href="/sign-up?method=phone" className="ml-1 font-medium text-[#7a451f] hover:underline">
                  创建 Altselfs
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
