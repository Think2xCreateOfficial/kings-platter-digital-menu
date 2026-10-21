/**
 * Consent-controlled, fully masked PostHog session replay for the digital menu.
 *
 * The controller owns every replay decision. The browser entry only wires the real SDK,
 * router and consent source into it, so the same code that ships is the code exercised by
 * `posthog-replay.check.mjs` against a mocked SDK.
 *
 * Rules encoded here:
 * - Missing project token or host is a no-op: the SDK is never initialized.
 * - New clients initialize opted out with replay disabled; only an explicit grant starts it.
 * - Recording is limited to the public menu journey; everything else is denied by default.
 * - Withdrawal opts out and stops recording.
 */

import type { CapturedNetworkRequest, PostHogConfig } from 'posthog-js';
import type { ConsentSource } from './consent';

export type { AnalyticsConsent, ConsentSource } from './consent';

/** posthog-js version this controller is written and checked against. */
export const REPLAY_SDK_VERSION = '1.438.13';

const NAVIGATION_EVENT = 'kp:navigation';

/** Routes that must never appear in a replay, even as a network URL. */
const SENSITIVE_ROUTE_PATTERNS: RegExp[] = [
  /^\/(?:admin|auth|login|logout|account|settings|checkout|payment|payments|billing|reset-password)(?:\/|$)/i,
  /^\/api(?:\/|$)/i,
  /^\/(?:internal|private)(?:\/|$)/i,
];

/** The only journey that may be recorded: the public menu. */
const SAFE_JOURNEY_PATTERNS: RegExp[] = [/^\/$/, /^\/menu(?:\/|$)/i];

/** Path segments long and random enough to be an identifier or token rather than a slug. */
const CREDENTIAL_LIKE_SEGMENT = /^(?:eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{32,})$/;

/** rrweb's own opt-out class plus this project's sensitive subtrees. */
export const SENSITIVE_DOM_SELECTOR = '.ph-no-capture, [data-ph-no-capture], [data-private]';

export interface ReplayEnv {
  projectToken?: string | null;
  host?: string | null;
}

export interface ReplaySdk {
  init: (projectToken: string, config: Partial<PostHogConfig>) => unknown;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
  startSessionRecording: () => void;
  stopSessionRecording: () => void;
  __loaded?: boolean;
}

export interface RouteSource {
  getPath(): string;
  subscribe(listener: (path?: string) => void): () => void;
}

export interface ReplayControllerDeps {
  sdk: ReplaySdk;
  router: RouteSource;
  consent: ConsentSource;
  env: ReplayEnv;
  isBrowser?: boolean;
  onError?: (error: unknown) => void;
}

export interface ReplayController {
  start(): void;
  sync(path?: string): void;
  destroy(): void;
  getState(): { initialized: boolean; recording: boolean };
}

function normalizePath(pathname: string | null | undefined): string {
  if (typeof pathname !== 'string' || pathname.length === 0) return '/';
  const withoutQuery = pathname.split('?')[0].split('#')[0];
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') || '/' : '/';
}

/** True for auth, payment, account and internal routes that must never be captured. */
export function isSensitivePath(pathname: string | null | undefined): boolean {
  const path = normalizePath(pathname);
  return SENSITIVE_ROUTE_PATTERNS.some((pattern) => pattern.test(path));
}

/** Default deny: only the public menu journey is recordable. */
export function isSafeJourneyPath(pathname: string | null | undefined): boolean {
  const path = normalizePath(pathname);
  if (isSensitivePath(path)) return false;
  return SAFE_JOURNEY_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Strips the query string and fragment from a URL that is about to be recorded.
 *
 * Session replay passes captured request URLs *and* replay page URLs through this hook,
 * so it must handle absolute, relative and malformed input. Returning `null` drops the URL.
 */
export function redactReplayUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;

  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return null;

  const placeholderOrigin = 'https://placeholder.invalid';
  let parsed: URL;
  try {
    parsed = new URL(trimmed, placeholderOrigin);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const pathname = parsed.pathname.length > 0 ? parsed.pathname : '/';
  if (isSensitivePath(pathname)) return null;
  if (pathname.split('/').some((segment) => CREDENTIAL_LIKE_SEGMENT.test(segment))) return null;

  const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  return isAbsolute ? `${parsed.origin}${pathname}` : pathname;
}

/** Replay network hook: redacts URLs and never records headers or bodies. */
export function maskCapturedNetworkRequest(request: CapturedNetworkRequest): CapturedNetworkRequest | null {
  const safeName = redactReplayUrl(request.name);
  if (!safeName) return null;

  return {
    ...request,
    name: safeName,
    requestHeaders: undefined,
    responseHeaders: undefined,
    requestBody: null,
    responseBody: null,
  };
}

/**
 * Local privacy configuration. These values are set on the new client at init so they
 * cannot be widened by remote project settings.
 */
export function buildReplayInitOptions(apiHost: string): Partial<PostHogConfig> {
  return {
    api_host: apiHost,
    opt_out_capturing_by_default: true,
    disable_session_recording: true,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    rageclick: false,
    capture_exceptions: false,
    capture_heatmaps: false,
    enable_recording_console_log: false,
    capture_performance: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
      recordBody: false,
      recordHeaders: false,
      captureCanvas: { recordCanvas: false },
      captureJsonLd: false,
      blockClass: 'ph-no-capture',
      blockSelector: SENSITIVE_DOM_SELECTOR,
      maskCapturedNetworkRequestFn: maskCapturedNetworkRequest,
    },
  };
}

function readEnvValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createReplayController(deps: ReplayControllerDeps): ReplayController {
  const reportError = (error: unknown) => {
    try {
      deps.onError?.(error);
    } catch {
      // Never let reporting break the page.
    }
  };

  const unsubscribers: Array<() => void> = [];
  let initialized = false;
  let optedIn = false;
  let recording = false;
  let started = false;
  let destroyed = false;

  const isBrowser = () => deps.isBrowser !== false;

  function initializeOnce(): boolean {
    if (initialized) return true;

    const projectToken = readEnvValue(deps.env.projectToken);
    const apiHost = readEnvValue(deps.env.host);
    if (!projectToken || !apiHost) return false;

    // Reuse an already-initialized browser client instead of creating a second one.
    if (deps.sdk.__loaded === true) {
      initialized = true;
      return true;
    }

    try {
      deps.sdk.init(projectToken, buildReplayInitOptions(apiHost));
    } catch (error) {
      reportError(error);
      return false;
    }

    initialized = true;
    return true;
  }

  function applyState(pathname?: string): void {
    if (destroyed || !initialized) return;

    const consented = deps.consent.get() === 'granted';
    const path = typeof pathname === 'string' ? pathname : deps.router.getPath();
    const recordable = consented && isSafeJourneyPath(path);

    try {
      if (!consented) {
        if (recording) {
          deps.sdk.stopSessionRecording();
          recording = false;
        }
        if (optedIn) {
          deps.sdk.opt_out_capturing();
          optedIn = false;
        }
        return;
      }

      if (!recordable) {
        if (recording) {
          deps.sdk.stopSessionRecording();
          recording = false;
        }
        return;
      }

      if (!optedIn) {
        deps.sdk.opt_in_capturing();
        optedIn = true;
      }
      if (!recording) {
        deps.sdk.startSessionRecording();
        recording = true;
      }
    } catch (error) {
      reportError(error);
    }
  }

  return {
    start() {
      if (destroyed || started) return;
      started = true;

      if (!isBrowser()) return;
      if (!initializeOnce()) return;

      unsubscribers.push(deps.consent.subscribe(() => applyState()));
      unsubscribers.push(deps.router.subscribe((path) => applyState(path)));

      applyState();
    },

    sync(pathname?: string) {
      applyState(pathname);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;

      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch (error) {
          reportError(error);
        }
      }

      if (recording) {
        try {
          deps.sdk.stopSessionRecording();
        } catch (error) {
          reportError(error);
        }
        recording = false;
      }
    },

    getState() {
      return { initialized, recording };
    },
  };
}

/** Extracts the path from a navigation URL without keeping its query or fragment. */
export function routePathFromUrl(url: unknown, baseUrl: string): string | null {
  if (typeof url !== 'string' || url.trim().length === 0) return null;
  try {
    const parsed = new URL(url.trim(), baseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return normalizePath(parsed.pathname);
  } catch {
    return null;
  }
}

/**
 * Bridge for Next.js App Router navigations. `instrumentation-client.ts` calls this from
 * `onRouterTransitionStart`, which fires before `window.location` reflects the new route.
 */
export function notifySessionReplayNavigation(url: string): void {
  if (typeof window === 'undefined') return;

  const path = routePathFromUrl(url, window.location.href);
  if (!path) return;

  window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT, { detail: { path } }));
}

/** Browser route source backed by `location`, back/forward and App Router transitions. */
export function createWindowRouter(win: Window): RouteSource {
  const listeners = new Set<(path?: string) => void>();
  let attached = false;

  const emit = (path?: string) => {
    for (const listener of [...listeners]) {
      listener(path);
    }
  };

  const onLocationChange = () => emit();
  const onAppNavigation = (event: Event) => {
    const detail = (event as CustomEvent<{ path?: string }>).detail;
    emit(detail?.path);
  };

  const attach = () => {
    if (attached) return;
    attached = true;
    win.addEventListener('popstate', onLocationChange);
    win.addEventListener(NAVIGATION_EVENT, onAppNavigation);
  };

  const detach = () => {
    if (!attached) return;
    attached = false;
    win.removeEventListener('popstate', onLocationChange);
    win.removeEventListener(NAVIGATION_EVENT, onAppNavigation);
  };

  return {
    getPath: () => normalizePath(win.location.pathname),
    subscribe(listener) {
      listeners.add(listener);
      attach();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) detach();
      };
    },
  };
}

let activeController: ReplayController | null = null;

/**
 * Mounts replay once per browser session. Calling it again (a remount, a Fast Refresh pass)
 * reuses the existing controller, so there is never a second client, init or listener pair.
 */
export function installSessionReplay(deps: ReplayControllerDeps): ReplayController {
  if (activeController) return activeController;

  const controller = createReplayController(deps);
  activeController = controller;
  controller.start();

  return controller;
}

export function syncSessionReplay(pathname?: string): void {
  activeController?.sync(pathname);
}

export function uninstallSessionReplay(): void {
  activeController?.destroy();
  activeController = null;
}
