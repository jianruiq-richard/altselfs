import Script from 'next/script';
import { CONSENT_BOOTSTRAP } from '@/lib/analytics/consent';

const configuredMeasurementId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim() || '';
const measurementId = /^G-[A-Z0-9]+$/i.test(configuredMeasurementId)
  ? configuredMeasurementId
  : '';
const debugMode = process.env.NEXT_PUBLIC_GA4_DEBUG === 'true';

export function GoogleAnalyticsScripts() {
  if (!measurementId) return null;

  const initialization = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = window.gtag || gtag;
    ${CONSENT_BOOTSTRAP}
    gtag('consent', 'default', {
      analytics_storage: minacoAnalyticsConsent,
      ad_storage: minacoAdConsent,
      ad_user_data: minacoAdConsent,
      ad_personalization: 'denied'
    });
    gtag('js', new Date());
    gtag('config', '${measurementId}', {
      send_page_view: false,
      allow_google_signals: false,
      debug_mode: ${debugMode ? 'true' : 'false'}
    });
  `;

  return (
    <>
      <script
        id="minaco-ga4-init"
        dangerouslySetInnerHTML={{ __html: initialization }}
      />
      <Script
        id="minaco-ga4-library"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
        strategy="afterInteractive"
      />
    </>
  );
}
