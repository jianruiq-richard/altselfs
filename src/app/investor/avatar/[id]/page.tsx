'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FigmaShell } from '@/components/figma-shell';

interface AvatarData {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  status: string;
  systemPrompt: string;
}

export default function AvatarManagePage() {
  const router = useRouter();
  const params = useParams();
  const avatarId = params.id as string;

  const [avatar, setAvatar] = useState<AvatarData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAvatar = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/avatar/${avatarId}`);
        const data = await response.json();
        if (!response.ok) {
          setError(data.error || '加载分身失败');
          return;
        }
        setAvatar(data.avatar);
      } catch {
        setError('网络错误，请稍后重试');
      } finally {
        setIsLoading(false);
      }
    };

    if (avatarId) {
      void fetchAvatar();
    }
  }, [avatarId]);

  const onChange = (key: keyof AvatarData, value: string) => {
    if (!avatar) return;
    setAvatar({ ...avatar, [key]: value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!avatar) return;

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/avatar/${avatar.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: avatar.name,
          description: avatar.description,
          avatar: avatar.avatar,
          status: avatar.status,
          systemPrompt: avatar.systemPrompt,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || '保存失败');
        return;
      }

      setAvatar(data.avatar);
      router.refresh();
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">加载中...</p>
      </div>
    );
  }

  if (!avatar) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <p className="text-slate-700 mb-4">未找到该分身或无权限访问</p>
          <Link href="/investor" className="text-blue-700 hover:underline">
            返回工作台
          </Link>
        </div>
      </div>
    );
  }

  return (
    <FigmaShell
      homeHref="/investor"
      title="管理分身"
      subtitle="调整分身设定与系统提示词"
      actions={
        <Link href="/investor" className="text-sm text-blue-700 hover:underline">
          返回工作台
        </Link>
      }
    >
      <form onSubmit={handleSave} className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">分身名称</label>
          <input
            type="text"
            value={avatar.name}
            onChange={(e) => onChange('name', e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">简介</label>
          <textarea
            value={avatar.description || ''}
            onChange={(e) => onChange('description', e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">头像 URL</label>
          <input
            type="url"
            value={avatar.avatar || ''}
            onChange={(e) => onChange('avatar', e.target.value)}
            placeholder="https://..."
            className="w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-slate-500">先支持 URL 方式上传，后续可扩展为文件上传。</p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">分身状态</label>
          <select
            value={avatar.status}
            onChange={(e) => onChange('status', e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ACTIVE">启用</option>
            <option value="INACTIVE">停用</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">System Prompt</label>
          <textarea
            value={avatar.systemPrompt}
            onChange={(e) => onChange('systemPrompt', e.target.value)}
            rows={10}
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-xl border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-100"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isSaving ? '保存中...' : '保存修改'}
          </button>
        </div>
      </form>
    </FigmaShell>
  );
}
