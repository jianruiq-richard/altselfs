'use client';

import { createContext, useCallback, useContext, useState, type ReactNode, type MouseEvent } from 'react';
import { SignIn, useUser } from '@clerk/nextjs';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { EmailPasswordSignUpForm } from './email-password-sign-up-form';
import { PhonePasswordAuthForm } from './phone-code-auth-form';
import { EmbeddedBrowserAuthGuard } from './embedded-browser-auth-guard';
import { MinacoBrandMark } from './minaco-brand-mark';
import { clerkAuthAppearance } from '@/lib/clerk-auth-appearance';
import { productBrand } from '@/lib/brand';
import styles from './astromar-auth.module.css';

type AuthMode = 'sign-in' | 'sign-up';
type AuthRequest = { mode: AuthMode; method: 'email' | 'phone'; redirectUrl: string };
const AuthModalContext = createContext<(mode?: AuthMode, redirectUrl?: string) => void>(() => {});
export const GUEST_DRAFT_KEY = 'minaco:guest-discussion-draft';
export function useAuthModal() { return useContext(AuthModalContext); }

export function AuthButtons({ className = '' }: { className?: string }) {
  const openAuth = useAuthModal();
  return <div className={`flex items-center justify-center gap-2 ${className}`}>
    <button type="button" onClick={() => openAuth('sign-in')} className="h-9 whitespace-nowrap rounded-lg border border-white/15 bg-white/[0.045] px-4 text-xs font-semibold text-zinc-100 transition hover:bg-white/10">Sign in</button>
    <button type="button" onClick={() => openAuth('sign-up')} className="h-9 whitespace-nowrap rounded-lg border border-[#f2c36b]/70 bg-[#f2c36b] px-4 text-xs font-semibold text-[#100e0c] transition hover:bg-[#f8dfaa]">Sign up</button>
  </div>;
}

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isSignedIn } = useUser();
  const [request, setRequest] = useState<AuthRequest | null>(null);
  const openAuth = useCallback((mode: AuthMode = 'sign-in', redirectUrl?: string) => {
    setRequest({ mode, method: 'email', redirectUrl: redirectUrl || '/app' });
  }, []);
  const [previousSignedIn, setPreviousSignedIn] = useState(isSignedIn);
  if (previousSignedIn !== isSignedIn) {
    setPreviousSignedIn(isSignedIn);
    if (isSignedIn) setRequest(null);
  }

  function interceptAuthLink(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank') return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || !/^\/sign-(in|up)\/?$/.test(url.pathname)) return;
    if (!request && /^\/sign-(in|up)/.test(pathname)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = url.searchParams.get('redirect_url');
    setRequest({
      mode: url.pathname.startsWith('/sign-up') ? 'sign-up' : 'sign-in',
      method: url.searchParams.get('method') === 'phone' ? 'phone' : 'email',
      redirectUrl: target?.startsWith('/') && !target.startsWith('//') && !/^\/sign-(in|up)/.test(target)
        ? target : request?.redirectUrl || '/app',
    });
  }

  return <AuthModalContext.Provider value={openAuth}>
    <div className="contents" onClickCapture={interceptAuthLink}>
      {children}
      <Dialog open={Boolean(request) && !isSignedIn} onClose={() => setRequest(null)} className="relative z-[100]">
        <DialogBackdrop className="fixed inset-0 bg-black/75 backdrop-blur-sm" />
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <DialogPanel className={`${styles.authModal} relative w-full max-w-[440px] rounded-2xl border border-white/10 bg-[#111213] p-6 shadow-2xl sm:p-8`}>
              {request && <>
                <button type="button" onClick={() => setRequest(null)} aria-label="Close authentication" className="absolute right-3 top-3 rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white"><X size={18} /></button>
                <MinacoBrandMark className="mb-5 block h-10 w-10 overflow-hidden rounded-xl" imageClassName="h-full w-full object-contain" />
                <DialogTitle className="text-2xl font-semibold tracking-tight text-[#fffaf0]">{request.mode === 'sign-in' ? `Sign in to ${productBrand.name}` : `Join ${productBrand.name}`}</DialogTitle>
                <p className="mt-2 text-sm text-zinc-400">Your AI cofounder. Think with you. Act for you.</p>
                <nav className={`${styles.modeTabs} mt-6`} aria-label="Authentication method">
                  {(['email', 'phone'] as const).map(method => <button key={method} type="button" className={request.method === method ? styles.modeTabActive : styles.modeTab} onClick={() => setRequest({ ...request, method })}>{method === 'email' ? 'Email / Google' : 'Phone / password'}</button>)}
                </nav>
                <div className={`${styles.authContent} mt-5`}>
                  {request.method === 'phone' ? <PhonePasswordAuthForm key={request.mode} mode={request.mode} redirectUrl={request.mode === 'sign-in' ? request.redirectUrl : undefined} /> :
                    <EmbeddedBrowserAuthGuard fallbackUrl={`${productBrand.canonicalUrl}/${request.mode}?method=email`} initiallyBlocked={false} mode={request.mode}>
                      {request.mode === 'sign-in' ? <SignIn routing="hash" forceRedirectUrl={request.redirectUrl} fallbackRedirectUrl={request.redirectUrl} signUpUrl="/sign-up?method=email" appearance={clerkAuthAppearance} /> : <EmailPasswordSignUpForm />}
                    </EmbeddedBrowserAuthGuard>}
                </div>
                <div className="mt-5 border-t border-white/10 pt-5 text-center text-xs text-zinc-400">
                  {request.mode === 'sign-in' ? 'New here? ' : 'Already have an account? '}
                  <button type="button" className="font-semibold text-[#f2c36b] hover:text-[#f8dfaa]" onClick={() => setRequest({ ...request, mode: request.mode === 'sign-in' ? 'sign-up' : 'sign-in' })}>{request.mode === 'sign-in' ? 'Sign up' : 'Sign in'}</button>
                </div>
              </>}
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </div>
  </AuthModalContext.Provider>;
}
