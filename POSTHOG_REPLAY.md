# PostHog session replay — handoff

Consent-controlled, fully masked session replay for the King's Platter digital menu.
The change is **uncommitted** on purpose: review the diff and keep or undo it.

## Repository baseline (recorded before any edit)

| Item | Value |
| --- | --- |
| Package manager | `npm` — `package-lock.json` (`lockfileVersion` 3) |
| Locks found | `package-lock.json` only. No `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`/`bun.lockb` |
| Workspaces | none — single package `kings-platter-digital-menu` at the repo root |
| Framework | Next.js 16.3.5 App Router (`src/app`), React 19, TypeScript `strict`, Tailwind 4 |
| SDK-importing package | the root package (only package in the repository) |
| Baseline `npm run typecheck` | passed |
| Baseline `npm run lint` | passed (`lint` is `tsc --noEmit` in this project) |
| Baseline tests | no test script existed; none are skipped or removed by this change |

Unrelated work in the working copy (`src/components/menu/HeroFoodBanner.tsx`, the hero images in
`public/`) was left exactly as it was.

## Install

```
npm install posthog-js@1.438.13
```

`posthog-js` is now a dependency pinned to exactly `1.438.13` in [package.json](package.json) and
resolved for the root importer in [package-lock.json](package-lock.json)
(`packages["node_modules/posthog-js"].version === "1.438.13"`). No install scripts, no second
package manager, no other dependency changes.

## Where the integration lives

| File | Role |
| --- | --- |
| [src/instrumentation-client.ts](src/instrumentation-client.ts) | Next.js browser entry. Imports the real `posthog-js` singleton, wires it to the controller, and forwards App Router transitions through `onRouterTransitionStart` |
| [src/lib/analytics/sessionReplay.ts](src/lib/analytics/sessionReplay.ts) | The tested controller: init gate, consent gate, journey gate, privacy config, URL redaction, singleton mount |
| [src/lib/analytics/consent.ts](src/lib/analytics/consent.ts) | The consent source: explicit `granted` / `denied` only; anything else is `unknown` |
| [src/components/common/AnalyticsConsentBanner.tsx](src/components/common/AnalyticsConsentBanner.tsx) | Visitor-facing allow / not-now / turn-off control, mounted from [src/app/layout.tsx](src/app/layout.tsx) |
| [posthog-replay.check.mjs](posthog-replay.check.mjs) | Offline checks against a mocked SDK, router and consent source |

The entry mounts `installSessionReplay(...)` from the controller, which memoizes a single
controller. Remounts and Fast Refresh passes reuse it, so there is never a second client, a second
`init`, a duplicate `startSessionRecording`, or a duplicated listener pair.

## SDK resolution

`src/instrumentation-client.ts` statically imports `posthog-js`, so the bundled SDK is the one
resolved through the root `node_modules` (single package, no workspaces, no path aliases around it).
`posthog-replay.check.mjs` asserts the manifest pin, the lockfile entry for the root importer, the
installed package version, and the absence of any second lockfile.

## Consent and recording rules

- No token or no host → **no init at all**; the integration is a no-op.
- New client → `opt_out_capturing_by_default: true`, `disable_session_recording: true`, plus every
  capture channel off (see below). An existing, already-initialized client is reused without a
  second `init`, and its settings are not overwritten.
- `unknown` or `denied` consent → never records.
- An explicit grant → `opt_in_capturing()` followed by a plain `startSessionRecording()`, called
  once. No override objects are passed, so project enablement, sampling, triggers, minimum
  duration and authorized domains still apply server-side.
- Navigating away from the menu journey, or into a sensitive route → `stopSessionRecording()`
  and the analytics session stays opted in only for the allowed journey.
- Withdrawal → `stopSessionRecording()` and `opt_out_capturing()`; a denied visitor who re-enters
  the journey stays stopped until they explicitly grant again.
- Consent is read only from an explicit `granted` / `denied` decision under
  `kp_analytics_consent`. A missing key, unreadable storage or an unknown value is `unknown`,
  which behaves like `denied` — there is no permissive fallback.

## Journey and route boundaries

**Recordable (default deny, these only):** `/`, `/menu`, `/menu/[kitchenSlug]`,
`/menu/[kitchenSlug]/category/[categorySlug]`, `/menu/[kitchenSlug]/food/[foodSlug]`.

**Never recorded:** `/admin/**` (dashboard, categories, food items, business profile, login),
`/api/**`, and any other route, including `/checkout`, `/account`, `/login`, `/auth`,
`/payment`, `/internal`, `/private`.

Recorded page URLs and captured network request URLs are passed through
`maskCapturedNetworkRequestFn`, which drops the query string and the fragment, returns `null`
(dropped) for sensitive or unparseable URLs and for token-like path segments, and always blanks
request/response headers and bodies. `before_send` is not used for this.

## Privacy options set at init

Top level: `autocapture`, `capture_pageview`, `capture_pageleave`, `capture_dead_clicks`,
`rageclick`, `capture_exceptions`, `capture_heatmaps` = `false`;
`enable_recording_console_log: false`; `capture_performance: false`;
`opt_out_capturing_by_default: true`; `disable_session_recording: true`.

Under `session_recording`: `maskAllInputs: true`, `maskTextSelector: "*"`, `recordBody: false`,
`recordHeaders: false`, `captureCanvas: { recordCanvas: false }`, `captureJsonLd: false`,
`blockClass: "ph-no-capture"`, `blockSelector: ".ph-no-capture, [data-ph-no-capture], [data-private]"`.

Canvas, JSON-LD, console, attributes and images cannot be covered by DOM text masking, so those
channels are disabled locally and the local `false` values override any remote enablement.
Sensitive subtrees must carry `ph-no-capture`, `data-ph-no-capture` or `data-private`: text
masking hides text only, never attributes or image sources. The consent banner is itself marked
`ph-no-capture`. No names, emails, form values, credentials or free text are added to any event
property — this integration sends no custom events at all.

## Environment variables (private setup)

Both are public browser values and are **empty** in [.env.example](.env.example):

```
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=
NEXT_PUBLIC_POSTHOG_HOST=
```

- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` — the project token from PostHog project settings
  (*Project* → *Settings* → *Project token*). It is the public token, never a personal or secret
  API key.
- `NEXT_PUBLIC_POSTHOG_HOST` — your project's region, no fallback:
  `https://us.i.posthog.com` (US) or `https://eu.i.posthog.com` (EU).

Set them in `.env.local` (or your hosting environment) — never commit them and never paste them
into a chat. With either one empty, replay stays off and the app behaves exactly as before.

No deployment, remote project settings or PostHog configuration are changed by this work.

## Checks

```
npm run replay:check    # node --import tsx --test posthog-replay.check.mjs — 15/15 pass, offline
npm run typecheck       # pass
npm run lint            # pass (tsc --noEmit)
npm run build           # pass — Next.js compiles the entry and bundles the controller + SDK
```

`posthog-replay.check.mjs` imports the real controller from
`src/lib/analytics/sessionReplay.ts` through the project's existing `tsx` loader and injects a
mocked SDK, router and consent source. It runs two cases in child processes with a scrubbed
environment (one empty, one with only a synthetic token and host) to prove nothing is
autoloaded from `.env*`. It also asserts the real entry and layout mount this code and that no
changed file contains a live credential.

## Private playback verification

1. Create or sign in to a PostHog account, open the project and read the project token and region.
2. Put both values into `.env.local`, restart `npm run dev`, and confirm the app starts.
3. In PostHog, check the project's session replay settings: recording enabled, sampling,
   triggers, minimum duration, and the authorized domain for your menu URL.
4. Open the menu at `/`, accept "Allow session replay", then walk the journey: `/` →
   `/menu/kings-platter` → a category → a food item → back.
5. Open the recording in PostHog. Confirm it shows a useful journey, that input values and text
   are masked, and that no sensitive URL, query string, header, body or free text appears.
6. Press "Turn off" in the banner (or "Not now" from a fresh session) and confirm the recording
   stops and no new replay arrives. Visit `/admin` and confirm nothing from it is captured.
7. If playback is missing or anything looks unmasked, do not treat this step as confirmed —
   report it without credentials.
