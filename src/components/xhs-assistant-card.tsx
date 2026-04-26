'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { connectXhsExtension, debugXhsExtension, detectXhsExtension } from '@/lib/xhs-extension-client';

type Props = {
  initialAccount: string;
  initialSummary: string;
  initialConnected: boolean;
  initialUnread: number;
};

export function XhsAssistantCard({
  initialAccount,
  initialSummary,
  initialConnected,
  initialUnread,
}: Props) {
  const [connected, setConnected] = useState(initialConnected);
  const [account, setAccount] = useState(initialAccount);
  const [summary, setSummary] = useState(initialSummary);
  const [unread] = useState(initialUnread);
  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [debugOutput, setDebugOutput] = useState('');

  useEffect(() => {
    let cancelled = false;
    detectXhsExtension()
      .then((installed) => {
        if (!cancelled) setExtensionInstalled(installed);
      })
      .catch(() => {
        if (!cancelled) setExtensionInstalled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnect = async () => {
    if (loading) return;
    setLoading(true);
    setMessage('');
    try {
      const auth = await connectXhsExtension();
      const res = await fetch('/api/investor/xiaohongshu/connector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookies: auth.cookies,
          accountName: auth.accountName,
          connectionMethod: 'browser_extension',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '小红书授权失败');
      }

      setConnected(true);
      setAccount(data.integration?.accountName || auth.accountName);
      setSummary('浏览器扩展已授权，小红书助手现在可以在对话中自动触发搜索 skill。');
      setMessage('授权成功，后续对话将使用你的浏览器登录态。');
      setDebugOutput('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '授权失败，请稍后重试');
      const debug = error instanceof Error && 'debug' in error ? (error as Error & { debug?: unknown }).debug : null;
      if (debug) {
        setDebugOutput(JSON.stringify(debug, null, 2));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDebug = async () => {
    if (loading) return;
    setLoading(true);
    setMessage('');
    try {
      const result = await debugXhsExtension();
      setDebugOutput(JSON.stringify(result, null, 2));
      setMessage('已运行扩展诊断。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '诊断失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (loading) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/investor/xiaohongshu/connector', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || '断开失败');
      }
      setConnected(false);
      setAccount('未配置 小红书能力');
      setSummary('已断开浏览器授权。重新连接后，小红书助手才可继续调用搜索 skill。');
      setMessage('已断开授权。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '断开失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-blue-300">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">小红书 助手</h3>
          <p className="mt-1 text-sm text-gray-500">{account}</p>
        </div>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{unread} 未读</span>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm text-gray-600">
        <Bot className="h-4 w-4 text-orange-500" />
        <span>小红书助手小橙</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {connected ? '已授权' : '未授权'}
        </span>
      </div>

      <p className="min-h-12 text-sm leading-6 text-gray-600">{summary}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleConnect()}
          disabled={loading}
          className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {loading ? '处理中...' : connected ? '刷新浏览器授权' : '连接浏览器扩展'}
        </button>
        <Link
          href="/investor/chat/xiaohongshu"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          进入对话
        </Link>
        <button
          type="button"
          onClick={() => void handleDebug()}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          运行诊断
        </button>
        {connected ? (
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={loading}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            断开授权
          </button>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {extensionInstalled
          ? '已检测到浏览器扩展。点击连接后会读取你当前浏览器里的小红书登录态。'
          : '未检测到浏览器扩展。安装后刷新当前页面，再点击“连接浏览器扩展”。'}
      </p>
      {message ? <p className="mt-2 text-xs text-slate-700">{message}</p> : null}
      {debugOutput ? (
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          {debugOutput}
        </pre>
      ) : null}
    </div>
  );
}
