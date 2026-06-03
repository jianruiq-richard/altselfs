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
    <main className="relative min-h-svh overflow-hidden bg-[#efe7dc] px-4 py-4 sm:px-6 lg:px-8">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-75"
        style={{ backgroundImage: "url('/office.png')" }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(33,21,14,0.88)_0%,rgba(58,38,25,0.76)_46%,rgba(239,231,220,0.9)_100%)]" />

      <div className="relative mx-auto flex min-h-[calc(100svh-2rem)] w-full max-w-6xl flex-col">
        <Link href="/" className="w-fit text-lg font-semibold tracking-wide text-[#fff8ee]">
          Altselfs
        </Link>

        <div className="grid flex-1 gap-5 py-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-start lg:gap-8 lg:pt-10">
          <section className="max-w-3xl pt-4 text-[#fff8ee] lg:pt-14">
            <h1 className="text-4xl font-semibold leading-tight drop-shadow-[0_2px_18px_rgba(0,0,0,0.35)] sm:text-5xl lg:whitespace-nowrap lg:text-6xl">
              创建你的 AI 决策分身
            </h1>
            <p className="mt-4 text-sm font-medium uppercase tracking-[0.2em] text-[#f4c983] sm:text-base">
              BUILD YOUR DECISION OS
            </p>
          </section>

          <section className="flex justify-center lg:justify-end">
            <div className="max-h-[calc(100svh-4rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-[#ead8bd] bg-[#fffaf2] p-4 shadow-2xl shadow-black/20 sm:p-6">
              <div className="mb-4 text-center">
                <h2 className="text-2xl font-semibold text-stone-950">注册 Altselfs</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  完成注册后进入你的 Decision OS 工作台
                </p>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-2">
                <Link
                  href={`${baseSignUpUrl}${methodJoiner}method=phone`}
                  className={`rounded-lg border py-2.5 text-center text-sm font-medium transition-colors ${
                    method === 'phone'
                      ? 'border-[#7a451f] bg-[#7a451f] text-white'
                      : 'border-[#d8c8b5] bg-white text-stone-700 hover:bg-[#fff4df]'
                  }`}
                >
                  手机号注册
                </Link>
                <Link
                  href={`${baseSignUpUrl}${methodJoiner}method=email`}
                  className={`rounded-lg border py-2.5 text-center text-sm font-medium transition-colors ${
                    method === 'email'
                      ? 'border-[#7a451f] bg-[#7a451f] text-white'
                      : 'border-[#d8c8b5] bg-white text-stone-700 hover:bg-[#fff4df]'
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
          </section>
        </div>
      </div>
    </main>
  );
}
