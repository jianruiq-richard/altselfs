'use client';

import { useUser } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function SetupPage() {
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = searchParams.get('role');
  const [isLoading, setIsLoading] = useState(false);

  const handleSetup = async () => {
    if (!user || !role) return;

    setIsLoading(true);

    try {
      const response = await fetch('/api/user/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clerkId: user.id,
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
        console.error('Failed to create user');
      }
    } catch (error) {
      console.error('Error:', error);
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