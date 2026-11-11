import { CONSENT_BOOTSTRAP } from './consent';

// Shared by Next layouts and the standalone homepage Route Handler.
export function clarityInitialization(configuredId: string | undefined): string {
  const id = configuredId?.trim() || '';
  if (!/^[a-z0-9]{6,32}$/i.test(id)) return '';
  return `
    ${CONSENT_BOOTSTRAP}
    (function(c,l,a,r,i,t,y){
      if (c.__minacoClarityInitialized) return;
      c.__minacoClarityInitialized = true;
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      c[a]('consentv2', {
        ad_Storage: minacoAdConsent,
        analytics_Storage: minacoAnalyticsConsent
      });
      t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window,document,'clarity','script','${id}');
  `;
}

export function clarityScriptTag(configuredId: string | undefined): string {
  const script = clarityInitialization(configuredId);
  return script ? '<script id="minaco-microsoft-clarity">' + script + '</script>' : '';
}
