'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArchiveRestore, CreditCard, RotateCcw, Trash2, UserCircle, WalletCards } from 'lucide-react';
import { displayEmail } from '@/lib/user-identifier';
import { FigmaShell } from '@/components/figma-shell';

type Profile = {
  id: string;
  email: string;
  name: string | null;
  nickname: string | null;
  phone: string | null;
  wechatId: string | null;
  role: 'INVESTOR' | 'CANDIDATE';
};

type ArchivedConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [archivedSessions, setArchivedSessions] = useState<ArchivedConversation[]>([]);
  const [assetActionId, setAssetActionId] = useState<string | null>(null);
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

  const loadArchivedSessions = async () => {
    setArchivedLoading(true);
    setArchivedError(null);
    try {
      const res = await fetch('/api/investor/personal-agent?sessions=1&sessionStatus=archived', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setArchivedError(data.error || 'Failed to load archived conversations');
        return;
      }
      setArchivedSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      setArchivedError('Network error. Please try again later.');
    } finally {
      setArchivedLoading(false);
    }
  };

  const openAssets = () => {
    setAssetsOpen(true);
    void loadArchivedSessions();
  };

  const updateArchivedSession = async (session: ArchivedConversation, action: 'unarchive' | 'permanent_delete') => {
    if (assetActionId) return;
    if (action === 'permanent_delete') {
      const confirmed = window.confirm('Delete this archived conversation? It will no longer be visible or accessible.');
      if (!confirmed) return;
    }
    setAssetActionId(session.id);
    setArchivedError(null);
    try {
      const res = await fetch('/api/investor/personal-agent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action, threadId: session.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setArchivedError(data.error || 'Failed to update conversation');
        return;
      }
      setArchivedSessions(Array.isArray(data.archivedSessions) ? data.archivedSessions : []);
    } catch {
      setArchivedError('Network error. Please try again later.');
    } finally {
      setAssetActionId(null);
    }
  };

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
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <UserCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Account</p>
              <p className="text-base font-semibold text-slate-950">{profile.nickname || profile.name || 'Altselfs user'}</p>
            </div>
          </div>
          <p className="mt-3 truncate text-sm text-slate-500">{displayEmail(profile.email)}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Credits</p>
              <p className="text-base font-semibold text-slate-950">0 credits</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-500">Usage and billing controls will be added here.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <WalletCards className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Subscription</p>
              <p className="text-base font-semibold text-slate-950">Free plan</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-500">Commercial plans are not enabled yet.</p>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Personal assets</h2>
            <p className="mt-1 text-sm text-slate-500">Manage archived conversations and assets connected to your account.</p>
          </div>
          <button
            type="button"
            onClick={openAssets}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <ArchiveRestore className="h-4 w-4" />
            View archived conversations
          </button>
        </div>

        {assetsOpen ? (
          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
            <div className="hidden grid-cols-[minmax(0,1fr)_12rem_8rem] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
              <span>Name</span>
              <span>Date created</span>
              <span className="text-right">Actions</span>
            </div>
            {archivedLoading ? (
              <div className="px-4 py-6 text-sm text-slate-500">Loading archived conversations...</div>
            ) : archivedSessions.length > 0 ? (
              <div className="divide-y divide-slate-200">
                {archivedSessions.map((session) => (
                  <div key={session.id} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_12rem_8rem] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{session.title || 'New conversation'}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{session.messageCount} messages</p>
                    </div>
                    <p className="text-sm text-slate-500">{formatDateTime(session.createdAt)}</p>
                    <div className="flex justify-start gap-1 md:justify-end">
                      <button
                        type="button"
                        title="Unarchive"
                        disabled={assetActionId === session.id}
                        onClick={() => void updateArchivedSession(session, 'unarchive')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Delete permanently"
                        disabled={assetActionId === session.id}
                        onClick={() => void updateArchivedSession(session, 'permanent_delete')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-100 text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6 text-sm text-slate-500">No archived conversations yet.</div>
            )}
            {archivedError ? <div className="border-t border-slate-200 px-4 py-3 text-sm text-red-600">{archivedError}</div> : null}
          </div>
        ) : null}
      </div>

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
