import { SignUp } from '@clerk/nextjs';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const role = (await searchParams).role;
  const normalizedRole = role === 'investor' ? 'investor' : role === 'candidate' ? 'candidate' : null;
  const redirectUrl = normalizedRole ? `/dashboard/setup?role=${normalizedRole}` : '/dashboard';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            {normalizedRole === 'investor' ? '注册投资人账户' :
             normalizedRole === 'candidate' ? '注册创业者账户' : '创建账户'}
          </h1>
          <p className="text-gray-600 mt-2">
            {normalizedRole === 'investor' ? '完成注册后将进入投资人控制台流程' :
             normalizedRole === 'candidate' ? '完成注册后将进入创业者对话流程' :
             '加入 AltSelfs 平台'}
          </p>
        </div>
        <SignUp forceRedirectUrl={redirectUrl} fallbackRedirectUrl={redirectUrl} />
      </div>
    </div>
  );
}
