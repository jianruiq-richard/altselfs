'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import {
  applyWorkspaceBootstrapPayload,
  applyWorkspacePersonalAgentPayload,
  resetWorkspaceClientCache,
  type WorkspaceBootstrapPayload,
  type WorkspacePersonalAgentPayload,
} from '@/lib/workspace-client-cache';
import { productBrand } from '@/lib/brand';

const DISCUSSION_URL = '/investor/chat/100';
const SIGN_IN_URL = `/sign-in?redirect_url=${encodeURIComponent('/dashboard/setup?role=investor')}`;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Workspace setup failed. Please try again.';
}

export function InvestorWorkspaceSetup() {
  const router = useRouter();
  const started = useRef(false);
  const [status, setStatus] = useState<'preparing' | 'redirecting' | 'failed'>('preparing');
  const [error, setError] = useState('');

  const prepareWorkspace = useCallback(async () => {
    setStatus('preparing');
    setError('');
    resetWorkspaceClientCache();

    try {
      const response = await fetch('/api/workspace/bootstrap', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const payload = (await response.json().catch(() => ({}))) as WorkspaceBootstrapPayload & { error?: string };

      if (response.status === 401) {
        router.replace(SIGN_IN_URL);
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      applyWorkspaceBootstrapPayload(payload);
      const sessions = Array.isArray(payload.personalAgent?.sessions)
        ? payload.personalAgent.sessions
        : [];
      const requestedThreadId = typeof payload.personalAgent?.threadId === 'string'
        ? payload.personalAgent.threadId
        : null;
      const threadId = requestedThreadId && sessions.some((session) => (
        session && typeof session === 'object' && 'id' in session && session.id === requestedThreadId
      ))
        ? requestedThreadId
        : null;

      if (threadId) {
        const discussionResponse = await fetch(
          `/api/investor/personal-agent?${new URLSearchParams({ threadId }).toString()}`,
          {
            cache: 'no-store',
            credentials: 'same-origin',
          },
        );
        const discussionPayload = (await discussionResponse.json().catch(() => ({}))) as WorkspacePersonalAgentPayload & {
          error?: string;
        };
        if (!discussionResponse.ok) {
          throw new Error(discussionPayload.error || `HTTP ${discussionResponse.status}`);
        }
        applyWorkspacePersonalAgentPayload({
          ...discussionPayload,
          threadId,
          sessions,
        });
      } else {
        applyWorkspacePersonalAgentPayload({
          threadId: null,
          sessions: [],
          messages: [],
          hasMore: false,
        });
      }

      setStatus('redirecting');
      router.replace(DISCUSSION_URL);
    } catch (setupError) {
      setStatus('failed');
      setError(getErrorMessage(setupError));
    }
  }, [router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void prepareWorkspace();
  }, [prepareWorkspace]);

  const isFailed = status === 'failed';

  return (
    <main className="grid min-h-svh place-items-center overflow-hidden bg-[#080909] px-5 py-10 text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'linear-gradient(to bottom, rgba(0,0,0,.85), transparent 88%)',
        }}
      />
      <section className="relative w-full max-w-[520px] rounded-[18px] border border-white/[0.11] bg-[#121313]/95 p-8 text-center shadow-2xl shadow-black/40">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-[12px] border border-white/[0.14] bg-white/[0.05]">
          {isFailed ? (
            <RefreshCw size={20} className="text-amber-300" aria-hidden="true" />
          ) : (
            <Loader2 size={21} className="animate-spin text-[#79a8ff]" aria-hidden="true" />
          )}
        </div>

        <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.26em] text-[#79a8ff]">
          {productBrand.name}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.01em] text-white">
          {isFailed ? 'Workspace setup needs another try.' : 'Preparing your workspace.'}
        </h1>
        <p className="mx-auto mt-3 max-w-[380px] text-sm leading-6 text-zinc-400">
          {isFailed
            ? 'The setup service did not finish cleanly. Retry will rebuild the missing account context before opening your discussion.'
            : `${productBrand.name} is creating your private account context, credits ledger, and discussion workspace before opening the app.`}
        </p>

        {error ? (
          <p className="mt-5 rounded-[10px] border border-red-400/25 bg-red-500/10 px-4 py-3 text-left text-sm text-red-200">
            {error}
          </p>
        ) : null}

        <div className="mt-7 rounded-[12px] border border-white/[0.08] bg-black/20 p-4 text-left">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-zinc-300">Account context</span>
            <span className="text-[#45d39b]">Secure</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 text-sm">
            <span className="text-zinc-300">Discussion workspace</span>
            <span className={isFailed ? 'text-zinc-500' : 'text-[#45d39b]'}>
              {status === 'redirecting' ? 'Ready' : isFailed ? 'Retry needed' : 'Preparing'}
            </span>
          </div>
        </div>

        {isFailed ? (
          <button
            type="button"
            onClick={() => void prepareWorkspace()}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-white px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
          >
            Retry setup
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <p className="mt-6 text-xs text-zinc-500">
            {status === 'redirecting' ? 'Opening your discussion...' : 'This usually takes a few seconds.'}
          </p>
        )}
      </section>
    </main>
  );
}
