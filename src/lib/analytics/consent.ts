/**
 * Analytics consent source for the digital menu.
 *
 * Consent is stored only as an explicit `granted` / `denied` decision. Anything else
 * (missing key, unreadable storage, unparseable value) resolves to `unknown`, which the
 * replay controller treats exactly like `denied`: nothing is recorded.
 */

export type AnalyticsConsent = 'granted' | 'denied' | 'unknown';

export interface ConsentSource {
  get(): AnalyticsConsent;
  subscribe(listener: (consent: AnalyticsConsent) => void): () => void;
}

export const ANALYTICS_CONSENT_KEY = 'kp_analytics_consent';
export const ANALYTICS_CONSENT_EVENT = 'kp:analytics-consent';

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the visitor's stored decision. No decision, no consent. */
export function readAnalyticsConsent(): AnalyticsConsent {
  const storage = getStorage();
  if (!storage) return 'unknown';
  try {
    const stored = storage.getItem(ANALYTICS_CONSENT_KEY);
    return stored === 'granted' || stored === 'denied' ? stored : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Records an explicit decision made by the visitor. */
export function setAnalyticsConsent(decision: 'granted' | 'denied'): void {
  const storage = getStorage();
  try {
    storage?.setItem(ANALYTICS_CONSENT_KEY, decision);
  } catch {
    // Storage may be unavailable (private mode, quota); the in-memory event still notifies listeners.
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<AnalyticsConsent>(ANALYTICS_CONSENT_EVENT, { detail: decision }));
  }
}

/** Subscribes to consent changes made in this tab or in another one. */
export function subscribeToAnalyticsConsent(listener: (consent: AnalyticsConsent) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const notify = () => listener(readAnalyticsConsent());
  window.addEventListener(ANALYTICS_CONSENT_EVENT, notify);
  window.addEventListener('storage', notify);

  return () => {
    window.removeEventListener(ANALYTICS_CONSENT_EVENT, notify);
    window.removeEventListener('storage', notify);
  };
}

/** The consent source the browser entry hands to the replay controller. */
export function createAnalyticsConsentSource(): ConsentSource {
  return {
    get: readAnalyticsConsent,
    subscribe: subscribeToAnalyticsConsent,
  };
}
