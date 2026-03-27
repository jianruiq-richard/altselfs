import { SignUp } from '@clerk/nextjs';

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">创建账户</h1>
          <p className="text-gray-600 mt-2">加入 AltSelfs 平台</p>
        </div>
        <SignUp />
      </div>
    </div>
  );
}