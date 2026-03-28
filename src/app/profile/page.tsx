'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { displayEmail } from '@/lib/user-identifier';

type Profile = {
  email: string;
  name: string | null;
  nickname: string | null;
  phone: string | null;
  wechatId: string | null;
  role: 'INVESTOR' | 'CANDIDATE';
};

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [wechatId, setWechatId] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/user/profile');
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || '加载个人信息失败');
          return;
        }
        setProfile(data.user);
        setNickname(data.user.nickname || '');
        setPhone(data.user.phone || '');
        setWechatId(data.user.wechatId || '');
      } catch {
        setError('网络错误，请稍后重试');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, phone, wechatId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '保存失败');
        return;
      }
      setProfile(data.user);
      setSuccess('保存成功');
      router.refresh();
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">加载中...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">无法获取个人信息</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="container mx-auto px-4 py-4">
          <Link href="/dashboard" className="text-blue-700 hover:underline text-sm">
            ← 返回控制台
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">个人信息</h1>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <form onSubmit={onSave} className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1">身份</label>
            <p className="text-slate-900 font-medium">{profile.role === 'INVESTOR' ? '投资人' : '创业者'}</p>
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">邮箱</label>
            <p className="text-slate-900">{displayEmail(profile.email)}</p>
          </div>
          <div>
            <label className="block text-sm text-slate-700 mb-1">昵称</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="请输入昵称"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-700 mb-1">联系电话</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="请输入联系电话"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-700 mb-1">微信号</label>
            <input
              value={wechatId}
              onChange={(e) => setWechatId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="请输入微信号"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-emerald-700">{success}</p>}

          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </form>
      </div>
    </div>
  );
}
