import Script from 'next/script';
import { CONSENT_BOOTSTRAP } from '@/lib/analytics/consent';

const configuredProjectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID?.trim() || '';
const projectId = /^[a-z0-9]{6,32}$/i.test(configuredProjectId)
  ? configuredProjectId
  : '';
export function MicrosoftClarityScripts() {
  if (!projectId) return null;

  const initialization = `
    ${CONSENT_BOOTSTRAP}
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      c[a]('consentv2', {
        ad_Storage: minacoAdConsent,
        analytics_Storage: minacoAnalyticsConsent
      });
      t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window,document,'clarity','script','${projectId}');
  `;

  return (
    <Script
      id="minaco-microsoft-clarity"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{ __html: initialization }}
    />
  );
}
