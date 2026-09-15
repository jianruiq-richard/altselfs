'use client';

import { useUser } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  completePendingAuthFlow,
  GA4_MEASUREMENT_ID,
  setAnalyticsUser,
  trackEvent,
  trackPageView,
} from '@/lib/analytics/client';

import { getConsentChoice, subscribeConsent } from '@/lib/analytics/consent';

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
    if (!GA4_MEASUREMENT_ID || !isLoaded) return;
    if (!isSignedIn) {
      setAnalyticsUser(null);
      return;
    }

    const controller = new AbortController();
    void fetch('/api/analytics/context', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return null;
      return response.json() as Promise<AnalyticsIdentity>;
    }).then((identity) => {
      if (!identity || controller.signal.aborted) return;
      setAnalyticsUser(identity.userId, {
        account_role: identity.role.toLowerCase(),
        plan_key: identity.planKey.toLowerCase(),
      });
      void completePendingAuthFlow(identity.registrationPending);
    }).catch(() => null);

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
