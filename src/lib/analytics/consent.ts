export const CONSENT_STORAGE_KEY = 'minaco.consent.v1';
export const CONSENT_CHANGED_EVENT = 'minaco:consent-changed';
export const DEFAULT_CONSENT_CHOICE = 'all' as const;
export type ConsentChoice = 'all' | 'analytics' | 'denied';
export type ConsentSnapshot = ConsentChoice | 'unknown' | 'loading';

declare global {
  interface Window {
    __minacoConsent?: ConsentChoice;
    clarity?: (...args: unknown[]) => void;
  }
}

export function parseConsentChoice(value: unknown): ConsentChoice | null {
  return value === 'all' || value === 'analytics' || value === 'denied' ? value : null;
}

export function getConsentChoice(): ConsentSnapshot {
  if (typeof window === 'undefined') return 'loading';
  try {
    const stored = parseConsentChoice(window.localStorage.getItem(CONSENT_STORAGE_KEY));
    if (stored) return stored;
  } catch { /* Use the current-page choice when browser storage is unavailable. */ }
  return window.__minacoConsent || DEFAULT_CONSENT_CHOICE;
}

export function consentParameters(choice: ConsentSnapshot) {
  return {
    analytics_storage: choice === 'all' || choice === 'analytics' ? 'granted' as const : 'denied' as const,
    ad_storage: choice === 'all' ? 'granted' as const : 'denied' as const,
    ad_user_data: choice === 'all' ? 'granted' as const : 'denied' as const,
    ad_personalization: 'denied' as const,
  };
}

function updateTags() {
  const consent = consentParameters(getConsentChoice());
  window.gtag?.('consent', 'update', consent);
  if (consent.analytics_storage === 'denied') window.gtag?.('set', { user_id: null });
  window.clarity?.('consentv2', {
    analytics_Storage: consent.analytics_storage,
    ad_Storage: consent.ad_storage,
  });
}

export function saveConsentChoice(choice: ConsentChoice) {
  window.__minacoConsent = choice;
  try { window.localStorage.setItem(CONSENT_STORAGE_KEY, choice); } catch { /* Page-local fallback. */ }
  updateTags();
  window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
}

export function subscribeConsent(listener: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== CONSENT_STORAGE_KEY && event.key !== null) return;
    window.__minacoConsent = undefined;
    updateTags();
    listener();
  };
  window.addEventListener(CONSENT_CHANGED_EVENT, listener);
  window.addEventListener('storage', storageChanged);
  return () => {
    window.removeEventListener(CONSENT_CHANGED_EVENT, listener);
    window.removeEventListener('storage', storageChanged);
  };
}

// Runs synchronously before either vendor initializes. Apply the site default
// only when no valid preference exists; do not persist it as a visitor's choice.
export const CONSENT_BOOTSTRAP = `
  var minacoChoice = window.__minacoConsent;
  try { minacoChoice = localStorage.getItem('${CONSENT_STORAGE_KEY}') || minacoChoice; } catch (_) {}
  if (minacoChoice !== 'all' && minacoChoice !== 'analytics' && minacoChoice !== 'denied') minacoChoice = '${DEFAULT_CONSENT_CHOICE}';
  var minacoAnalyticsConsent = minacoChoice === 'all' || minacoChoice === 'analytics' ? 'granted' : 'denied';
  var minacoAdConsent = minacoChoice === 'all' ? 'granted' : 'denied';
`;
