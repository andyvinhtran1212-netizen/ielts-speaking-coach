/** Gate E Speaking: stable App Router dark URL without a false native/cutover claim. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_PLAYER_AFFINITY_POLICY } from '../lib/core-player-affinity.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const readFrontend = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const readRoot = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');

const LEGACY = readFrontend('public', 'pages', 'practice.html');
const PAGE = readFrontend('app', '(authed-practice)', 'practice', 'session', 'page.tsx');
const SHELL = readFrontend('app', '(authed-practice)', 'practice', 'session', 'practice-page-shell.tsx');
const BOOT = readFrontend('app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx');
const LAYOUT = readFrontend('app', '(authed-practice)', 'layout.tsx');
const PAIRS = JSON.parse(readFrontend('tooling', 'parity-pairs-authed.json'));
const DOC = readRoot('docs', 'GATE_E_SPEAKING_CORE_2026-08-09.md');

describe('/practice/session transitional dark route', () => {
  test('native React shell owns every player state and preserves the legacy DOM ids', () => {
    for (const state of [
      'loading', 'error', 'mode-choice', 'prep', 'p2a', 'p2b', 'p2c',
      'processing', 'feedback', 'test-results', 'completion', 'sheet',
    ]) {
      assert.match(SHELL, new RegExp(`id="state-${state}"`), state);
    }
    const legacyIds = new Set([...LEGACY.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const nativeIds = new Set([...SHELL.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    legacyIds.delete('');
    assert.deepEqual(nativeIds, legacyIds);
    const legacyIcons = [...LEGACY.matchAll(/data-lucide="([^"]+)"/g)].map((match) => match[1]);
    const nativeIcons = [...SHELL.matchAll(/<Icon name="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(nativeIcons, legacyIcons);
    const legacyActions = [...LEGACY.matchAll(/onclick="PracticeApp\.([A-Za-z0-9_]+)/g)]
      .map((match) => match[1]);
    const nativeActions = [...SHELL.matchAll(/callPractice\('([A-Za-z0-9_]+)'/g)]
      .map((match) => match[1]);
    assert.deepEqual(nativeActions, legacyActions);
    assert.match(SHELL, /name="mic" className="practice-rec-ring__icon"/);
    assert.doesNotMatch(SHELL, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(SHELL, /data-lucide/);
    assert.match(SHELL, /callPractice\('submitRecording'\)/);
    assert.match(SHELL, /callPractice\('finishSession'\)/);
  });

  test('App Router owns the URL and renders canonical chrome, native shell and guarded boot', () => {
    assert.match(PAGE, /<aver-chrome active="speaking"/);
    assert.match(PAGE, /<PracticePageShell \/>/);
    assert.match(PAGE, /<PracticeRecorderBridge \/>/);
    assert.match(PAGE, /<PracticeSubmissionBridge \/>/);
    assert.match(PAGE, /<PracticeSessionBoot \/>/);
    assert.match(SHELL, /^'use client';/);
    assert.match(SHELL, /function callPractice/);
    assert.match(SHELL, /function Icon/);
  });

  test('layout preserves the legacy CSS and script ordering', () => {
    assert.match(LAYOUT, /pageStylesheets=\{\['\/css\/practice\.css', '\/css\/speaking-assignment\.css'\]\}/);
    const debt = LAYOUT.indexOf('/js/speaking-debt.js');
    const practice = LAYOUT.indexOf('/js/practice.js');
    const pronunciation = LAYOUT.indexOf('/js/pronunciation-drilldown.js');
    assert.ok(debt !== -1 && debt < practice && practice < pronunciation);
    assert.match(LAYOUT, /antialiased min-h-screen flex flex-col/);
  });

  test('boot waits for signed-in auth plus the runtime and fails visibly', () => {
    assert.match(BOOT, /status === 'initial-loading'/);
    assert.match(BOOT, /status === 'signed-out'/);
    assert.match(BOOT, /whenGlobalReady\(/);
    assert.match(BOOT, /PracticeApp\?\.init/);
    assert.match(BOOT, /win\.api\?\.get/);
    assert.match(BOOT, /loadPracticeBootstrap/);
    assert.match(BOOT, /createPracticeBootstrapOnce/);
    assert.doesNotMatch(BOOT, /win\.getSupabase/);
    assert.match(BOOT, /started\.current = true/);
    assert.match(BOOT, /state-error/);
    assert.match(BOOT, /practice_native_bootstrap_failed/);
  });

  test('dark route exists but admission remains fail-closed on legacy', () => {
    const speaking = CORE_PLAYER_AFFINITY_POLICY.surfaces.speaking;
    assert.equal(speaking.next.path, '/practice/session');
    assert.equal(speaking.next.route_ready, false);
    assert.equal(speaking.admit_new, 'legacy');
    assert.match(
      DOC,
      /NATIVE BOOTSTRAP \+ RECORDER \+ SUBMISSION \+ FULL-TEST STATE \+[\s\S]{0,40}PLAYER LIFECYCLE/,
    );
    assert.match(DOC, /renderer\/copy\/feedback động sang React state\/client components/);
    assert.match(DOC, /JSX ownership không được dùng để tuyên bố native behavior/);
    assert.match(DOC, /`route_ready=false` giữ nguyên/);
  });

  test('parity inventory includes the missing-session branch with an honest limitation', () => {
    const pair = PAIRS.find((item) => item.name === 'speaking-practice-dark');
    assert.equal(pair.legacy, '/pages/practice.html');
    assert.equal(pair.next, '/practice/session');
    assert.ok(pair.note.includes('THIẾU session_id'));
    assert.ok(pair.note.includes('không chứng minh'));
  });
});
