import { CONSENT_BOOTSTRAP } from './consent';

export function googleTagInitialization(measurementId: string, debug = false) {
  if (!/^G-[A-Z0-9]+$/i.test(measurementId)) return '';
  return `
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){window.dataLayer.push(arguments);};
    ${CONSENT_BOOTSTRAP}
    gtag('consent', 'default', {analytics_storage:minacoAnalyticsConsent, ad_storage:minacoAdConsent, ad_user_data:minacoAdConsent, ad_personalization:'denied'});
    var minacoLocation = new URL(location.origin + location.pathname);
    var minacoQuery = new URLSearchParams(location.search);
    minacoQuery.forEach(function(value,key){if (/^(utm_(source|medium|campaign|id|term|content|source_platform|creative_format|marketing_tactic)|gclid|gbraid|wbraid)$/.test(key)) minacoLocation.searchParams.set(key,value.slice(0,200));});
    gtag('js', new Date());
    gtag('config', '${measurementId}', {page_location:minacoLocation.href, send_page_view:false, allow_google_signals:false, debug_mode:${debug}});
  `;
}

export function landingGoogleTag(measurementId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim() || '') {
  const init = googleTagInitialization(measurementId);
  // Attribution collection also works without GA4, subject to the same consent.
  return (init ? `<script id="minaco-ga4-init">${init}</script><script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>` : '') +
    '<script defer src="/minaco-analytics.js" data-landing="true"></script>';
}
