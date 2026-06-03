'use client';

import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { buildFallbackEmail } from '@/lib/user-identifier';

export default function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { user } = useUser();
  const router = useRouter();
  const role = use(searchParams).role;
  const normalizedRole = role === 'candidate' ? 'candidate' : 'investor';
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState(user?.primaryPhoneNumber?.phoneNumber || '');
  const [wechatId, setWechatId] = useState('');
  const autoSetupTriggered = useRef(false);

  useEffect(() => {
    if (user?.primaryPhoneNumber?.phoneNumber && !phone) {
      setPhone(user.primaryPhoneNumber.phoneNumber);
    }
  }, [user, phone]);

  const handleSetup = useCallback(async () => {
    if (!user) return;
    if (normalizedRole === 'candidate' && (!nickname.trim() || !phone.trim() || !wechatId.trim())) {
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
          role: normalizedRole.toUpperCase(),
          nickname: normalizedRole === 'candidate' ? nickname.trim() : undefined,
          phone: normalizedRole === 'candidate' ? phone.trim() : undefined,
          wechatId: normalizedRole === 'candidate' ? wechatId.trim() : undefined,
        }),
      });

      if (response.ok) {
        const target = normalizedRole === 'investor' ? '/dashboard' : '/candidate';
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
  }, [nickname, normalizedRole, phone, router, user, wechatId]);

  useEffect(() => {
    if (!user) return;
    if (normalizedRole !== 'investor') return;
    if (autoSetupTriggered.current) return;
    autoSetupTriggered.current = true;
    void handleSetup();
  }, [user, normalizedRole, handleSetup]);

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#efe7dc] px-4">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-60"
        style={{ backgroundImage: "url('/office.png')" }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(105deg,rgba(38,24,15,0.86)_0%,rgba(83,55,36,0.72)_48%,rgba(239,231,220,0.86)_100%)]" />

      <div className="relative w-full max-w-md rounded-2xl border border-[#ead8bd] bg-[#fffaf2] p-8 shadow-2xl shadow-black/20">
        <div className="text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#9a5a28]">
            Altselfs
          </p>
          <h1 className="mb-4 text-2xl font-semibold text-stone-950">
            正在初始化你的 Decision OS
          </h1>
          <p className="mb-8 text-sm leading-6 text-stone-600">
            正在创建你的基础账户和默认 AI 决策分身
          </p>

          {error && (
            <p className="mb-4 text-sm text-red-700">{error}</p>
          )}

          {normalizedRole === 'candidate' && (
            <div className="space-y-3 mb-6 text-left">
              <div>
                <label className="mb-1 block text-sm text-stone-700">昵称 *</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full rounded-xl border border-[#d8c8b5] bg-white px-3 py-2 text-stone-950 outline-none focus:border-[#7a451f]"
                  placeholder="请输入你的昵称"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-stone-700">联系电话 *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-[#d8c8b5] bg-white px-3 py-2 text-stone-950 outline-none focus:border-[#7a451f]"
                  placeholder="请输入手机号或电话"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-stone-700">微信号 *</label>
                <input
                  type="text"
                  value={wechatId}
                  onChange={(e) => setWechatId(e.target.value)}
                  className="w-full rounded-xl border border-[#d8c8b5] bg-white px-3 py-2 text-stone-950 outline-none focus:border-[#7a451f]"
                  placeholder="请输入微信号"
                />
              </div>
            </div>
          )}

          {normalizedRole === 'candidate' ? (
            <button
              onClick={handleSetup}
              disabled={isLoading}
              className="w-full rounded-xl bg-[#7a451f] px-6 py-3 font-semibold text-white transition-colors duration-200 hover:bg-[#6b3c1b] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? '设置中...' : '确认并继续'}
            </button>
          ) : (
            <div className="w-full rounded-xl border border-[#ead8bd] bg-white px-4 py-3 text-sm text-stone-600">
              {isLoading ? '正在创建账户...' : '正在进入 Decision OS 工作台...'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
