'use client';

import { AlertTriangle, Check, Copy } from 'lucide-react';
import {
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
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

function isGoogleOAuthTrigger(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const trigger = target.closest('button, a, [role="button"]');
  if (!trigger) {
    return false;
  }

  const searchableText = [
    trigger.textContent,
    trigger.getAttribute('aria-label'),
    trigger.getAttribute('title'),
    trigger.getAttribute('data-localization-key'),
    trigger.getAttribute('data-provider'),
    trigger.getAttribute('data-strategy'),
    trigger.getAttribute('href'),
  ]
    .filter(Boolean)
    .join(' ');

  return /\bgoogle\b|oauth_google/i.test(searchableText);
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
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  function blockGoogleOAuth(event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) {
    if (!isBlocked || !isGoogleOAuthTrigger(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsPromptOpen(true);
  }

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

  const actionLabel = mode === 'sign-up' ? 'Sign up' : 'Sign in';

  return (
    <div
      onClickCapture={blockGoogleOAuth}
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          blockGoogleOAuth(event);
        }
      }}
    >
      {children}

      {isPromptOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-sm rounded-md border border-amber-200 bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md bg-amber-100 p-2 text-amber-700">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-slate-950">Browser sign-in required</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Google {actionLabel} may not work inside an embedded browser. Open this page in Safari or Chrome, then try again.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="break-all text-xs leading-5 text-slate-600">{currentUrl}</p>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setIsPromptOpen(false)}
                className="inline-flex flex-1 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                content/Email
              </button>
              <button
                type="button"
                onClick={copyCurrentUrl}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? 'content' : 'content'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
