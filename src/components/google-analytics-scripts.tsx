import Script from 'next/script';
import { googleTagInitialization } from '@/lib/analytics/google-tag';

const configuredMeasurementId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim() || '';
const measurementId = /^G-[A-Z0-9]+$/i.test(configuredMeasurementId)
  ? configuredMeasurementId
  : '';
const debugMode = process.env.NEXT_PUBLIC_GA4_DEBUG === 'true';

export function GoogleAnalyticsScripts() {
  if (!measurementId) return <script defer src="/minaco-analytics.js" />;

  const initialization = googleTagInitialization(measurementId, debugMode);

  return (
    <>
      <script defer src="/minaco-analytics.js" />
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
