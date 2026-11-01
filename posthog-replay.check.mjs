/**
 * Offline checks for the consent-controlled session replay integration.
 *
 * Run with:  npm run replay:check   (node --import tsx --test posthog-replay.check.mjs)
 *
 * The fixture imports the controller that `src/instrumentation-client.ts` mounts and drives
 * it with a mocked SDK, router and consent source. No network, no dotenv, no real token.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  REPLAY_SDK_VERSION,
  buildReplayInitOptions,
  createReplayController,
  installSessionReplay,
  isSafeJourneyPath,
  isSensitivePath,
  maskCapturedNetworkRequest,
  redactReplayUrl,
  uninstallSessionReplay,
} from './src/lib/analytics/sessionReplay.ts';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONTROLLER_PATH = path.join(ROOT, 'src', 'lib', 'analytics', 'sessionReplay.ts');
const CONTROLLER_URL = pathToFileURL(CONTROLLER_PATH).href;

// Synthetic values only. Never uses a real project token shape (no phc_/phx_ prefix).
const SYNTHETIC_TOKEN = 'synthetic-project-token';
const SYNTHETIC_HOST = 'https://posthog.invalid';
const SYNTHETIC_ENV = { projectToken: SYNTHETIC_TOKEN, host: SYNTHETIC_HOST };

const SAFE_ROUTE = '/menu/kings-platter';
const SAFE_FOOD_ROUTE = '/menu/kings-platter/food/chicken-biryani';

function createMockSdk({ loaded = false, failInit = false, failStart = false, failOptIn = false } = {}) {
  const calls = { init: [], optIn: 0, optOut: 0, start: 0, stop: 0 };
  const sdk = {
    __loaded: loaded,
    init(projectToken, config) {
      if (failInit) throw new Error('mock init failed');
      calls.init.push({ projectToken, config });
    },
    opt_in_capturing() {
      if (failOptIn) throw new Error('mock opt-in failed');
      calls.optIn += 1;
    },
    opt_out_capturing() {
      calls.optOut += 1;
    },
    startSessionRecording() {
      calls.start += 1;
      if (failStart) throw new Error('mock start failed');
    },
    stopSessionRecording() {
      calls.stop += 1;
    },
  };
  return { sdk, calls };
}

function createMockConsent(initial = 'unknown') {
  let current = initial;
  const listeners = new Set();
  return {
    source: {
      get: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    set(decision) {
      current = decision;
      for (const listener of [...listeners]) listener(decision);
    },
    listenerCount: () => listeners.size,
  };
}

function createMockRouter(initialPath = SAFE_ROUTE) {
  let current = initialPath;
  const listeners = new Set();
  return {
    source: {
      getPath: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    navigate(nextPath) {
      current = nextPath;
      for (const listener of [...listeners]) listener(nextPath);
    },
    listenerCount: () => listeners.size,
  };
}

function mount({ env = SYNTHETIC_ENV, consent = 'unknown', route = SAFE_ROUTE, sdkOptions = {}, autostart = true } = {}) {
  const { sdk, calls } = createMockSdk(sdkOptions);
  const consentStore = createMockConsent(consent);
  const router = createMockRouter(route);
  const errors = [];
  const controller = createReplayController({
    sdk,
    consent: consentStore.source,
    router: router.source,
    env,
    isBrowser: true,
    onError: (error) => errors.push(error),
  });
  if (autostart) controller.start();
  return { sdk, calls, consentStore, router, errors, controller };
}

test('missing project token or host is a no-op, even with consent', () => {
  const envs = [
    {},
    { projectToken: SYNTHETIC_TOKEN },
    { host: SYNTHETIC_HOST },
    { projectToken: '   ', host: SYNTHETIC_HOST },
    { projectToken: SYNTHETIC_TOKEN, host: '' },
  ];

  for (const env of envs) {
    const { calls, controller, consentStore, router } = mount({ env, consent: 'granted' });

    controller.start();

    assert.equal(calls.init.length, 0, `no init for ${JSON.stringify(env)}`);
    assert.equal(calls.optIn, 0);
    assert.equal(calls.start, 0);
    assert.equal(controller.getState().initialized, false);
    assert.equal(consentStore.listenerCount(), 0, 'no listeners without an SDK');
    assert.equal(router.listenerCount(), 0);
  }
});

test('new client initializes opted out with every capture channel masked or disabled', () => {
  const { calls } = mount({ consent: 'unknown' });

  assert.equal(calls.init.length, 1);
  const { projectToken, config } = calls.init[0];
  const options = buildReplayInitOptions(SYNTHETIC_HOST);

  assert.equal(projectToken, SYNTHETIC_TOKEN);
  assert.deepEqual(config, options);

  assert.equal(config.api_host, SYNTHETIC_HOST);
  assert.equal(config.opt_out_capturing_by_default, true);
  assert.equal(config.disable_session_recording, true);

  for (const channel of [
    'autocapture',
    'capture_pageview',
    'capture_pageleave',
    'capture_dead_clicks',
    'rageclick',
    'capture_exceptions',
    'capture_heatmaps',
  ]) {
    assert.equal(config[channel], false, `${channel} is disabled`);
  }

  assert.equal(config.enable_recording_console_log, false);
  assert.equal(config.capture_performance, false);

  const replay = config.session_recording;
  assert.equal(replay.maskAllInputs, true);
  assert.equal(replay.maskTextSelector, '*');
  assert.equal(replay.recordBody, false);
  assert.equal(replay.recordHeaders, false);
  assert.deepEqual(replay.captureCanvas, { recordCanvas: false });
  assert.equal(replay.captureJsonLd, false);
  assert.equal(replay.maskCapturedNetworkRequestFn, maskCapturedNetworkRequest);
  assert.match(String(replay.blockClass), /ph-no-capture/);
  assert.match(String(replay.blockSelector), /ph-no-capture/);
  assert.equal(calls.optIn, 0, 'unknown consent never opts in');
  assert.equal(calls.start, 0, 'unknown consent never records');
});

test('unknown and denied consent never start recording', () => {
  for (const decision of ['unknown', 'denied']) {
    const { calls, controller, consentStore, router } = mount({ consent: decision });

    consentStore.set(decision);
    router.navigate(SAFE_ROUTE);
    router.navigate(SAFE_FOOD_ROUTE);
    controller.sync(SAFE_ROUTE);

    assert.equal(controller.getState().initialized, true);
    assert.equal(calls.optIn, 0, `${decision} never opts in`);
    assert.equal(calls.start, 0, `${decision} never records`);
  }
});

test('an explicit grant on the journey starts one masked recording', () => {
  const { calls, controller, consentStore, router } = mount({ consent: 'granted' });

  assert.equal(calls.optIn, 1);
  assert.equal(calls.start, 1);

  controller.sync();
  controller.sync(SAFE_FOOD_ROUTE);
  router.navigate(SAFE_FOOD_ROUTE);
  consentStore.set('granted');
  router.navigate(SAFE_ROUTE);

  assert.equal(calls.optIn, 1, 'no duplicate opt-in');
  assert.equal(calls.start, 1, 'no duplicate start');
  assert.equal(calls.stop, 0);
  assert.equal(controller.getState().recording, true);
});

test('remounting the entry adds no second init, start or listener pair', () => {
  const { sdk, calls } = createMockSdk();
  const consentStore = createMockConsent('granted');
  const router = createMockRouter(SAFE_ROUTE);
  const deps = {
    sdk,
    consent: consentStore.source,
    router: router.source,
    env: SYNTHETIC_ENV,
    isBrowser: true,
  };

  const first = installSessionReplay(deps);
  const second = installSessionReplay({ ...deps, sdk: createMockSdk().sdk });

  assert.equal(first, second, 'the mounted controller is a singleton');
  assert.equal(calls.init.length, 1);
  assert.equal(calls.start, 1);
  assert.equal(consentStore.listenerCount(), 1);
  assert.equal(router.listenerCount(), 1);

  uninstallSessionReplay();

  assert.equal(consentStore.listenerCount(), 0, 'consent listeners are cleaned up');
  assert.equal(router.listenerCount(), 0, 'route listeners are cleaned up');
});

test('leaving the journey, entering a sensitive route or withdrawal stops capture', () => {
  const { calls, consentStore, router } = mount({ consent: 'granted' });
  assert.equal(calls.start, 1);

  router.navigate('/somewhere-else');
  assert.equal(calls.stop, 1, 'exit stops recording');

  router.navigate(SAFE_ROUTE);
  assert.equal(calls.start, 2, 'the public menu may resume');

  router.navigate('/admin/categories');
  assert.equal(calls.stop, 2, 'admin stops recording');

  router.navigate('/api/auth/login');
  assert.equal(calls.stop, 2, 'a sensitive route does not restart recording');

  router.navigate(SAFE_FOOD_ROUTE);
  assert.equal(calls.start, 3);

  consentStore.set('denied');
  assert.equal(calls.stop, 3, 'withdrawal stops recording');
  assert.equal(calls.optOut, 1, 'withdrawal opts out of analytics');

  router.navigate(SAFE_ROUTE);
  assert.equal(calls.start, 3, 'denied re-entry stays stopped');

  consentStore.set('unknown');
  assert.equal(calls.start, 3);
  assert.equal(calls.optOut, 1, 'unknown consent does not toggle opt-out again');

  consentStore.set('granted');
  assert.equal(calls.start, 4, 'a fresh explicit grant may record again');
  assert.equal(calls.optIn, 2);
});

test('existing browser clients keep their settings without a second init', () => {
  const { calls, controller } = mount({ consent: 'granted', sdkOptions: { loaded: true } });

  assert.equal(calls.init.length, 0, 'the existing singleton is reused');
  assert.equal(calls.optIn, 1);
  assert.equal(calls.start, 1);
  assert.equal(controller.getState().recording, true);
});

test('SDK failures never break the page', () => {
  const brokenInit = mount({ consent: 'granted', sdkOptions: { failInit: true }, autostart: false });
  assert.doesNotThrow(() => brokenInit.controller.start());
  assert.equal(brokenInit.calls.start, 0);
  assert.equal(brokenInit.errors.length, 1);
  assert.equal(brokenInit.controller.getState().initialized, false);

  const brokenStart = mount({ consent: 'granted', sdkOptions: { failStart: true }, autostart: false });
  assert.doesNotThrow(() => brokenStart.controller.start());
  assert.equal(brokenStart.calls.start, 1, 'the start was attempted');
  assert.equal(brokenStart.controller.getState().recording, false);
  assert.equal(brokenStart.errors.length, 1);

  const brokenOptIn = mount({ consent: 'granted', sdkOptions: { failOptIn: true }, autostart: false });
  assert.doesNotThrow(() => brokenOptIn.controller.start());
  assert.doesNotThrow(() => brokenOptIn.router.navigate('/admin'));

  const brokenRouter = mount({ consent: 'granted' });
  brokenRouter.controller.destroy();
  assert.doesNotThrow(() => brokenRouter.router.navigate(SAFE_ROUTE));
});

test('replay URL hook removes query and fragment and drops unsafe URLs', () => {
  const replay = buildReplayInitOptions(SYNTHETIC_HOST).session_recording;
  const hook = replay.maskCapturedNetworkRequestFn;

  const captured = hook({
    name: 'https://menu.example.com/menu/kings-platter?token=synthetic-secret#receipt',
    initiatorType: 'xmlhttprequest',
    method: 'POST',
    requestBody: '{"email":"synthetic@example.com"}',
    requestHeaders: { authorization: 'Bearer synthetic' },
    responseBody: 'synthetic response body',
    responseHeaders: { 'set-cookie': 'synthetic-cookie' },
  });

  assert.notEqual(captured, null);
  assert.equal(captured.name, 'https://menu.example.com/menu/kings-platter');
  assert.equal(captured.requestBody, null);
  assert.equal(captured.responseBody, null);
  assert.equal(captured.requestHeaders, undefined);
  assert.equal(captured.responseHeaders, undefined);
  assert.ok(!JSON.stringify(captured).includes('synthetic-secret'));
  assert.ok(!JSON.stringify(captured).includes('synthetic@example.com'));

  assert.equal(redactReplayUrl('/menu/kings-platter?email=synthetic@example.com#top'), '/menu/kings-platter');
  assert.equal(redactReplayUrl('/menu/kings-platter#top'), '/menu/kings-platter');
  assert.equal(redactReplayUrl('https://menu.example.com/?utm_source=qr'), 'https://menu.example.com/');

  for (const unsafe of [
    'https://menu.example.com/admin/categories?tab=1',
    '/admin/login?expired=true',
    '/api/auth/login?token=synthetic',
    '/account/payment',
    `https://menu.example.com/menu/${'a1b2c3d4e5f6'.repeat(4)}`,
    'https://',
    'http://[::1',
    'javascript:alert(1)',
    '',
    null,
    42,
  ]) {
    assert.equal(redactReplayUrl(unsafe), null, `drops ${String(unsafe)}`);
    assert.equal(hook({ name: unsafe }), null);
  }
});

test('journey rules: public menu only, sensitive routes never', () => {
  for (const route of ['/', '/menu', '/menu/kings-platter', '/menu/kings-platter/category/biryani', SAFE_FOOD_ROUTE]) {
    assert.equal(isSafeJourneyPath(route), true, route);
  }

  for (const route of ['/admin', '/admin/login', '/api/auth/login', '/checkout', '/account', '/somewhere-else']) {
    assert.equal(isSafeJourneyPath(route), false, route);
  }

  for (const route of ['/admin', '/admin/food-items', '/api/upload', '/login', '/account/settings', '/checkout']) {
    assert.equal(isSensitivePath(route), true, route);
  }

  assert.equal(isSensitivePath('/menu/kings-platter'), false);
});

test('the real Next.js entry and layout mount the checked code', () => {
  const entry = readFileSync(path.join(ROOT, 'src', 'instrumentation-client.ts'), 'utf8');

  assert.match(entry, /from '@\/lib\/analytics\/sessionReplay'/);
  assert.match(entry, /installSessionReplay\(/);
  assert.match(entry, /NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN/);
  assert.match(entry, /NEXT_PUBLIC_POSTHOG_HOST/);
  assert.match(entry, /notifySessionReplayNavigation\(/);
  assert.match(entry, /onRouterTransitionStart/);

  const layout = readFileSync(path.join(ROOT, 'src', 'app', 'layout.tsx'), 'utf8');
  assert.match(layout, /AnalyticsConsentBanner/, 'the consent control is mounted');
});

test('the workspace manifest and lock pin posthog-js and resolve it for the importer', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.workspaces, undefined, 'single-package repository');
  assert.equal(manifest.dependencies['posthog-js'], REPLAY_SDK_VERSION);

  const lockPath = path.join(ROOT, 'package-lock.json');
  assert.equal(existsSync(lockPath), true, 'the original npm lock is kept');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

  assert.ok(Number(lock.lockfileVersion) >= 2, 'a readable npm lockfile');
  assert.equal(lock.packages[''].dependencies['posthog-js'], REPLAY_SDK_VERSION, 'declared by the root importer');
  assert.equal(lock.packages['node_modules/posthog-js'].version, REPLAY_SDK_VERSION, 'resolved in the lock');
  assert.equal(lock.name, manifest.name);

  for (const foreignLock of ['yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json']) {
    assert.equal(existsSync(path.join(ROOT, foreignLock)), false, `${foreignLock} is not a second lock`);
  }

  const installed = JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'posthog-js', 'package.json'), 'utf8'));
  assert.equal(installed.name, 'posthog-js');
  assert.equal(installed.version, REPLAY_SDK_VERSION, 'the resolved SDK is the pinned version');
});

test('changed files contain no live PostHog credential', () => {
  const files = [
    'src/instrumentation-client.ts',
    'src/lib/analytics/sessionReplay.ts',
    'src/lib/analytics/consent.ts',
    'src/components/common/AnalyticsConsentBanner.tsx',
    '.env.example',
    'posthog-replay.check.mjs',
  ];

  for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(text, /ph[ch]_[A-Za-z0-9]{8,}/, `${file} holds no project token`);
    assert.doesNotMatch(text, /synthetic[_-]?api[_-]?key/i, `${file} holds no api key`);
  }

  const example = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  assert.match(example, /^NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=\s*$/m, 'example token is empty');
  assert.match(example, /^NEXT_PUBLIC_POSTHOG_HOST=\s*$/m, 'example host is empty');
});

function runIsolatedChild(source, extraEnv) {
  const inherited = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SystemDrive', 'windir', 'TEMP', 'TMP', 'PATHEXT', 'ComSpec', 'HOME', 'USERPROFILE']) {
    if (process.env[key] !== undefined) inherited[key] = process.env[key];
  }

  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: ROOT,
    env: { ...inherited, ...extraEnv },
    encoding: 'utf8',
    timeout: 120000,
  });
}

const CHILD_SOURCE = `
const calls = [];
const sdk = {
  init(token) { calls.push('init:' + token); },
  opt_in_capturing() { calls.push('opt_in'); },
  opt_out_capturing() { calls.push('opt_out'); },
  startSessionRecording() { calls.push('start'); },
  stopSessionRecording() { calls.push('stop'); },
};
const { createReplayController } = await import(${JSON.stringify(CONTROLLER_URL)});
const controller = createReplayController({
  sdk,
  consent: { get: () => 'granted', subscribe: () => () => {} },
  router: { getPath: () => '/menu/kings-platter', subscribe: () => () => {} },
  env: {
    projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  },
  isBrowser: true,
  onError: () => {},
});
controller.start();
process.stdout.write(JSON.stringify(calls));
`;

test('a child process with an empty environment never initializes the SDK', () => {
  const child = runIsolatedChild(CHILD_SOURCE, {});

  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), [], 'no dotenv or framework config is autoloaded');
});

test('a child process with only synthetic config injects nothing but the granted journey', () => {
  const child = runIsolatedChild(CHILD_SOURCE, {
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: SYNTHETIC_TOKEN,
    NEXT_PUBLIC_POSTHOG_HOST: SYNTHETIC_HOST,
  });

  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), [`init:${SYNTHETIC_TOKEN}`, 'opt_in', 'start']);
});
