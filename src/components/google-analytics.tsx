'use client';

import { useUser } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  completePendingAuthFlow,
  GA4_MEASUREMENT_ID,
  getAnalyticsSessionContext,
  setAnalyticsUser,
  trackEvent,
  trackPageView,
} from '@/lib/analytics/client';

import { getConsentChoice, subscribeConsent } from '@/lib/analytics/consent';

declare global {
  interface Window {
    minacoAttribution?: {read: (userId: string) => unknown; bind: (userId: string) => void};
    minacoPosthog?: {read: () => string | null};
  }
}

type AnalyticsIdentity = {
  userId: string;
  role: string;
  planKey: string;
  registrationPending: boolean;
};

export function GoogleAnalytics() {
  const pathname = usePathname();
  const consent = useSyncExternalStore(subscribeConsent, getConsentChoice, () => 'loading');
  const { isLoaded, isSignedIn } = useUser();
  const lastPagePath = useRef('');

  useEffect(() => {
    if (!GA4_MEASUREMENT_ID || pathname === lastPagePath.current) return;
    lastPagePath.current = pathname;
    trackPageView(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setAnalyticsUser(null);
      return;
    }

    const controller = new AbortController();
    void (async () => {
      for (let attempt = 0; attempt < 4 && !controller.signal.aborted; attempt++) {
        try {
          const response = await fetch('/api/analytics/context', {
            cache:'no-store', credentials:'same-origin', signal:controller.signal,
          });
          if (!response.ok) throw new Error('Analytics identity not ready');
          const identity = await response.json() as AnalyticsIdentity;
          if (controller.signal.aborted) return;
          setAnalyticsUser(identity.userId, {account_role:identity.role.toLowerCase(),plan_key:identity.planKey.toLowerCase()});
          void completePendingAuthFlow(identity.registrationPending);
          const analytics = await getAnalyticsSessionContext();
          if (controller.signal.aborted) return;
          const attribution = window.minacoAttribution?.read(identity.userId);
          const saved = await fetch('/api/analytics/context', {
            method:'POST', credentials:'same-origin', keepalive:true,
            headers:{'Content-Type':'application/json'}, body:JSON.stringify({
              analytics,
              attribution,
              posthogDistinctId: window.minacoPosthog?.read() || null,
            }),
          });
          if (!saved.ok) throw new Error('Analytics binding not ready');
          window.minacoAttribution?.bind(identity.userId);
          return;
        } catch {
          if (attempt < 3 && !controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 250 * 4 ** attempt));
        }
      }
    })();

    return () => controller.abort();
  }, [isLoaded, isSignedIn, pathname, consent]);

  useEffect(() => {
    if (!GA4_MEASUREMENT_ID) return;
    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const trigger = event.target.closest<HTMLElement>('[data-analytics-cta]');
      if (!trigger) return;
      trackEvent('cta_click', {
        cta_id: trigger.dataset.analyticsCta,
        cta_location: trigger.dataset.analyticsLocation,
        destination: trigger instanceof HTMLAnchorElement
          ? new URL(trigger.href, window.location.href).pathname
          : trigger.dataset.analyticsDestination,
      });
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  return null;
}
