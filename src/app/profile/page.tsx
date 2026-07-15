'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { displayEmail } from '@/lib/user-identifier';
import { FigmaShell } from '@/components/figma-shell';

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
          setError(data.error || 'Failed to load profile');
          return;
        }
        setProfile(data.user);
        setNickname(data.user.nickname || '');
        setPhone(data.user.phone || '');
        setWechatId(data.user.wechatId || '');
      } catch {
        setError('Network error. Please try again later.');
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
        setError(data.error || 'Failed to save profile');
        return;
      }
      setProfile(data.user);
      setSuccess('Saved');
      router.refresh();
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">Loading...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">Profile unavailable</p>
      </div>
    );
  }

  return (
    <FigmaShell
      homeHref="/dashboard"
      title="Profile"
      subtitle="Manage your account profile and contact information"
      actions={
        <Link href="/dashboard" className="text-sm text-blue-700 hover:underline">
          Back to workspace
        </Link>
      }
    >
      <form onSubmit={onSave} className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-sm text-slate-600 mb-1">Role</label>
          <p className="text-slate-900 font-medium">Altselfs user</p>
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1">Email</label>
          <p className="text-slate-900">{displayEmail(profile.email)}</p>
        </div>
        <div>
          <label className="block text-sm text-slate-700 mb-1">Display name</label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Display name"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-700 mb-1">Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Phone number"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-700 mb-1">WeChat ID</label>
          <input
            value={wechatId}
            onChange={(e) => setWechatId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="WeChat ID"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-emerald-700">{success}</p>}

        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </FigmaShell>
  );
}
