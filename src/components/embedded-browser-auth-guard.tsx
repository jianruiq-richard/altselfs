'use client';

import { AlertTriangle, Check, Copy } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { isOauthBlockedEmbeddedBrowser } from '@/lib/oauth-browser';

type EmbeddedBrowserAuthGuardProps = {
  children: ReactNode;
  fallbackUrl: string;
  initiallyBlocked: boolean;
  mode: 'sign-in' | 'sign-up';
};

function subscribeToBrowserSnapshot() {
  return () => {};
}

export function EmbeddedBrowserAuthGuard({
  children,
  fallbackUrl,
  initiallyBlocked,
  mode,
}: EmbeddedBrowserAuthGuardProps) {
  const isBlocked = useSyncExternalStore(
    subscribeToBrowserSnapshot,
    () => isOauthBlockedEmbeddedBrowser(navigator.userAgent),
    () => initiallyBlocked
  );
  const currentUrl = useSyncExternalStore(
    subscribeToBrowserSnapshot,
    () => window.location.href,
    () => fallbackUrl
  );
  const [copied, setCopied] = useState(false);

  async function copyCurrentUrl() {
    try {
      await navigator.clipboard.writeText(currentUrl);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = currentUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!isBlocked) {
    return <>{children}</>;
  }

  const actionLabel = mode === 'sign-up' ? '注册' : '登录';

  return (
    <div className="rounded-md border border-amber-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-amber-100 p-2 text-amber-700">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-950">请在系统浏览器中继续</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Google {actionLabel}会拒绝微信内置浏览器发起的请求。请点右上角“...”并选择“在浏览器打开”，
            或复制链接到 Safari、Chrome 后继续。
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="break-all text-xs leading-5 text-slate-600">{currentUrl}</p>
      </div>

      <button
        type="button"
        onClick={copyCurrentUrl}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Copy className="h-4 w-4" aria-hidden="true" />
        )}
        {copied ? '已复制' : '复制链接'}
      </button>
    </div>
  );
}
