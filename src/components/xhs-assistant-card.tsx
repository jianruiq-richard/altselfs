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
        throw new Error(data.error || 'contentfailed');
      }

      setConnected(true);
      setAccount(data.integration?.accountName || auth.accountName);
      setSummary('content, Xiaohongshu Assistantcontent skill.');
      setMessage('content, sign in.');
      setDebugOutput('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'contentfailed, content');
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
      setMessage('content.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'contentfailed');
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
        throw new Error((data as { error?: string }).error || 'contentfailed');
      }
      setConnected(false);
      setAccount('content content');
      setSummary('content.content, Xiaohongshu Assistantcontent skill.');
      setMessage('content.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'contentfailed, content');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-blue-300">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">content content</h3>
          <p className="mt-1 text-sm text-gray-500">{account}</p>
        </div>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{unread} content</span>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm text-gray-600">
        <Bot className="h-4 w-4 text-orange-500" />
        <span>Xiaohongshu Assistantcontent</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {connected ? 'content' : 'content'}
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
          {loading ? 'Processing...' : connected ? 'content' : 'content'}
        </button>
        <Link
          href="/investor/chat/xiaohongshu"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          content
        </Link>
        <button
          type="button"
          onClick={() => void handleDebug()}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          content
        </button>
        {connected ? (
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={loading}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            content
          </button>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {extensionInstalled
          ? 'content.sign in.'
          : 'content.content, content"content".'}
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
