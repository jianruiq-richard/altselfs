import { SignUp } from '@clerk/nextjs';
import Link from 'next/link';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; method?: string }>;
}) {
  const params = await searchParams;
  const method = params.method === 'email' ? 'email' : 'phone';
  const baseSignUpUrl = '/sign-up';
  const methodJoiner = baseSignUpUrl.includes('?') ? '&' : '?';
  const redirectUrl = '/dashboard/setup';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">注册 OPC 账户</h1>
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
        <SignUp
          key={method}
          forceRedirectUrl={redirectUrl}
          fallbackRedirectUrl={redirectUrl}
          initialValues={method === 'phone' ? { phoneNumber: '+86' } : { emailAddress: '' }}
        />
      </div>
    </div>
  );
}
