import Script from 'next/script';

const configuredMeasurementId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim() || '';
const measurementId = /^G-[A-Z0-9]+$/i.test(configuredMeasurementId)
  ? configuredMeasurementId
  : '';
const analyticsStorage = process.env.NEXT_PUBLIC_GA4_ANALYTICS_STORAGE === 'granted'
  ? 'granted'
  : 'denied';
const debugMode = process.env.NEXT_PUBLIC_GA4_DEBUG === 'true';

export function GoogleAnalyticsScripts() {
  if (!measurementId) return null;

  const initialization = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = window.gtag || gtag;
    gtag('consent', 'default', {
      analytics_storage: '${analyticsStorage}',
      ad_storage: 'denied',
      ad_user_data: 'denied',
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
