import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">欢迎回来</h1>
          <p className="text-gray-600 mt-2">登录到 AltSelfs（支持邮箱、Google、手机号验证码）</p>
        </div>
        <SignIn forceRedirectUrl="/dashboard" fallbackRedirectUrl="/dashboard" />
        <div className="mt-4 text-sm text-center text-gray-600">
          还没账号？
          <Link href="/sign-up?role=investor" className="text-blue-600 hover:underline ml-1">
            注册为投资人
          </Link>
          <span className="mx-2">|</span>
          <Link href="/sign-up?role=candidate" className="text-green-600 hover:underline">
            注册为创业者
          </Link>
        </div>
      </div>
    </div>
  );
}
