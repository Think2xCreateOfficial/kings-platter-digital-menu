'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  AnalyticsConsent,
  readAnalyticsConsent,
  setAnalyticsConsent,
  subscribeToAnalyticsConsent,
} from '@/lib/analytics/consent';

/**
 * Explicit consent control for masked session replay.
 *
 * A visitor who has not chosen is never recorded; "Not now" stores a denial and the
 * banner stays out of the way afterwards. The banner itself is excluded from replays.
 */
export function AnalyticsConsentBanner() {
  const pathname = usePathname();
  const [consent, setConsent] = useState<AnalyticsConsent>('unknown');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setConsent(readAnalyticsConsent());
    setIsReady(true);
    return subscribeToAnalyticsConsent(setConsent);
  }, []);

  if (!isReady || pathname?.startsWith('/admin')) return null;

  if (consent === 'granted') {
    return (
      <div
        data-ph-no-capture
        className="ph-no-capture fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-full border border-[#2a2a30] bg-[#141418]/95 px-4 py-2 text-xs text-[#9A9AA5] shadow-lg backdrop-blur"
      >
        <span className="hidden sm:inline">Session recording is on · masked</span>
        <button
          type="button"
          onClick={() => setAnalyticsConsent('denied')}
          className="font-semibold text-[#E5A93C] underline-offset-2 hover:underline"
        >
          Turn off
        </button>
      </div>
    );
  }

  if (consent === 'denied') return null;

  return (
    <div
      data-ph-no-capture
      className="ph-no-capture fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl rounded-2xl border border-[#2a2a30] bg-[#141418]/95 p-4 text-sm text-[#E8E8ED] shadow-2xl backdrop-blur"
    >
      <p className="leading-relaxed">
        We would like to record a masked session of your visit to improve this menu. Inputs and text are
        hidden, and no details are shared with anyone else.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAnalyticsConsent('granted')}
          className="rounded-full bg-[#E5A93C] px-4 py-1.5 text-xs font-semibold text-[#0D0D10] transition hover:bg-[#f0bb5c]"
        >
          Allow session replay
        </button>
        <button
          type="button"
          onClick={() => setAnalyticsConsent('denied')}
          className="rounded-full border border-[#2a2a30] px-4 py-1.5 text-xs font-semibold text-[#9A9AA5] transition hover:text-[#E8E8ED]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
