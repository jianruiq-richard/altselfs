import Script from 'next/script';
import { clarityInitialization } from '@/lib/analytics/clarity';

export function MicrosoftClarityScripts() {
  const initialization = clarityInitialization(process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID);
  if (!initialization) return null;
  return <Script id="minaco-microsoft-clarity" strategy="afterInteractive"
    dangerouslySetInnerHTML={{ __html: initialization }} />;
}
