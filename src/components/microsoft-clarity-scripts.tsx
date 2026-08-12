import Script from 'next/script';

const configuredProjectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID?.trim() || '';
const projectId = /^[a-z0-9]{6,32}$/i.test(configuredProjectId)
  ? configuredProjectId
  : '';
const analyticsStorage = process.env.NEXT_PUBLIC_CLARITY_ANALYTICS_STORAGE === 'granted'
  ? 'granted'
  : 'denied';

export function MicrosoftClarityScripts() {
  if (!projectId) return null;

  const initialization = `
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      c[a]('consentv2', {
        ad_Storage: 'denied',
        analytics_Storage: '${analyticsStorage}'
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
