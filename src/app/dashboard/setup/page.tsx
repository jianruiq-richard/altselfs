'use client';

import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { buildFallbackEmail } from '@/lib/user-identifier';

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
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState(user?.primaryPhoneNumber?.phoneNumber || '');
  const [wechatId, setWechatId] = useState('');

  useEffect(() => {
    if (user?.primaryPhoneNumber?.phoneNumber && !phone) {
      setPhone(user.primaryPhoneNumber.phoneNumber);
    }
  }, [user, phone]);

  const handleSetup = async () => {
    if (!user || !role) return;
    if (role === 'candidate' && (!nickname.trim() || !phone.trim() || !wechatId.trim())) {
      setError('请先填写昵称、联系电话和微信号');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/user/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email:
            user.primaryEmailAddress?.emailAddress ||
            user.emailAddresses[0]?.emailAddress ||
            buildFallbackEmail(user.id),
          name: user.fullName,
          role: role.toUpperCase(),
          nickname: role === 'candidate' ? nickname.trim() : undefined,
          phone: role === 'candidate' ? phone.trim() : undefined,
          wechatId: role === 'candidate' ? wechatId.trim() : undefined,
        }),
      });

      if (response.ok) {
        const target = role === 'investor' ? '/investor' : '/candidate';
        router.replace(target);
        router.refresh();
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

          {role === 'candidate' && (
            <div className="space-y-3 mb-6 text-left">
              <div>
                <label className="block text-sm text-gray-700 mb-1">昵称 *</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入你的昵称"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">联系电话 *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入手机号或电话"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">微信号 *</label>
                <input
                  type="text"
                  value={wechatId}
                  onChange={(e) => setWechatId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入微信号"
                />
              </div>
            </div>
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
