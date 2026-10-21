/**
 * Next.js client instrumentation entry (App Router, Next >= 15.3).
 *
 * Runs in the browser before hydration. It mounts the consent-controlled session replay
 * controller with the real posthog-js singleton; all replay decisions live in
 * `src/lib/analytics/sessionReplay.ts`, which is exercised by `posthog-replay.check.mjs`.
 */
import posthog from 'posthog-js';
import { createAnalyticsConsentSource } from '@/lib/analytics/consent';
import {
  createWindowRouter,
  installSessionReplay,
  notifySessionReplayNavigation,
} from '@/lib/analytics/sessionReplay';

if (typeof window !== 'undefined') {
  installSessionReplay({
    sdk: posthog,
    router: createWindowRouter(window),
    consent: createAnalyticsConsentSource(),
    env: {
      projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    },
    onError: (error) => console.warn('[analytics] session replay unavailable:', error),
  });
}

/** Keeps replay paused outside the public menu journey before the new route renders. */
export function onRouterTransitionStart(url: string): void {
  notifySessionReplayNavigation(url);
}
