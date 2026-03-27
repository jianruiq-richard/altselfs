'use client';

import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

export default function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { user } = useUser();
  const router = useRouter();
  const role = use(searchParams).role;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSetup = async () => {
    if (!user || !role) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/user/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: user.emailAddresses[0]?.emailAddress,
          name: user.fullName,
          role: role.toUpperCase(),
        }),
      });

      if (response.ok) {
        if (role === 'investor') {
          router.push('/investor');
        } else {
          router.push('/candidate');
        }
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error || '账户设置失败，请稍后重试');
      }
    } catch (error) {
      console.error('Error:', error);
      setError('网络错误，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">参数错误</h1>
          <p className="text-gray-600">请重新选择身份</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            确认身份
          </h1>
          <p className="text-gray-600 mb-8">
            你选择了：<span className="font-semibold">
              {role === 'investor' ? '投资人' : '创业者'}
            </span>
          </p>

          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            onClick={handleSetup}
            disabled={isLoading}
            className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? '设置中...' : '确认并继续'}
          </button>
        </div>
      </div>
    </div>
  );
}
