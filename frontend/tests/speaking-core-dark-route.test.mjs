/** Gate E Speaking: ready App Router dark URL without a false admission/cutover claim. */
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
const PLAYER_BRIDGE = readFrontend('app', '(authed-practice)', 'practice', 'session', 'practice-player-bridge.tsx');
const PLAYER_LIFECYCLE = readFrontend('lib', 'practice-player-lifecycle.mjs');
const BOOT = readFrontend('app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx');
const LAYOUT = readFrontend('app', '(authed-practice)', 'layout.tsx');
const PAIRS = JSON.parse(readFrontend('tooling', 'parity-pairs-authed.json'));
const DOC = readRoot('docs', 'GATE_E_SPEAKING_CORE_2026-08-09.md');
const PARITY_GATE = readRoot('.github', 'workflows', 'parity-gate.yml');

const LUCIDE_1_17_ICON_SIGNATURES = {
  'chevron-left': ['d="m15 18-6-6 6-6"'],
  'alert-triangle': ['d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"', 'd="M12 9v4"', 'd="M12 17h.01"'],
  eye: ['d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"', 'cx="12" cy="12" r="3"'],
  'volume-2': ['d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"', 'd="M16 9a5 5 0 0 1 0 6"', 'd="M19.364 18.364a9 9 0 0 0 0-12.728"'],
  mic: ['d="M12 19v3"', 'd="M19 10v2a7 7 0 0 1-14 0v-2"', 'x="9" y="2" width="6" height="13" rx="3"'],
  square: ['width="18" height="18" x="3" y="3" rx="2"'],
  'rotate-ccw': ['d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"', 'd="M3 3v5h5"'],
  'check-circle': ['d="M21.801 10A10 10 0 1 1 17 3.335"', 'd="m9 11 3 3L22 4"'],
  'check-circle-2': ['cx="12" cy="12" r="10"', 'd="m9 12 2 2 4-4"'],
  upload: ['d="M12 3v12"', 'd="m17 8-5-5-5 5"', 'd="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"'],
  play: ['d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"'],
  'arrow-left': ['d="m12 19-7-7 7-7"', 'd="M19 12H5"'],
  'arrow-right': ['d="M5 12h14"', 'd="m12 5 7 7-7 7"'],
  check: ['d="M20 6 9 17l-5-5"'],
  clock: ['cx="12" cy="12" r="10"', 'd="M12 6v6l4 2"'],
  'clipboard-list': ['width="8" height="4" x="8" y="2" rx="1" ry="1"', 'd="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"', 'd="M12 11h4"', 'd="M12 16h4"', 'd="M8 11h.01"', 'd="M8 16h.01"'],
  download: ['d="M12 15V3"', 'd="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"', 'd="m7 10 5 5 5-5"'],
  'file-down': ['d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"', 'd="M14 2v5a1 1 0 0 0 1 1h5"', 'd="M12 18v-6"', 'd="m9 15 3 3 3-3"'],
};

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
    const nativeSheetActions = new Set([
      'sheetListen', 'sheetToggleRecording', 'sheetRetrySubmission',
      'sheetReview', 'submitSheet',
    ]);
    const nativeOnlyActions = new Set([...nativeSheetActions, 'trackGrammarResource']);
    assert.deepEqual(nativeActions.filter((action) => !nativeOnlyActions.has(action)), legacyActions);
    assert.deepEqual(nativeActions.filter((action) => nativeSheetActions.has(action)), [
      'sheetListen', 'sheetToggleRecording', 'sheetRetrySubmission',
      'sheetReview', 'submitSheet',
    ]);
    assert.deepEqual(nativeActions.filter((action) => action === 'trackGrammarResource'), [
      'trackGrammarResource', 'trackGrammarResource',
    ]);
    assert.match(SHELL, /name="mic" className="practice-rec-ring__icon"/);
    assert.doesNotMatch(SHELL, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(SHELL, /data-lucide/);
    assert.match(SHELL, /callPractice\('submitRecording'\)/);
    assert.match(SHELL, /callPractice\('finishSession'\)/);
  });

  test('native state frames, feedback composition and learner-facing copy preserve legacy styling contracts', () => {
    const stagedStates = [
      'state-mode-choice', 'state-prep', 'state-p2a', 'state-p2b',
      'state-p2c', 'state-feedback', 'state-completion', 'state-test-results',
    ];
    const stateClasses = (source, id) => source.match(
      new RegExp(`id="${id}" class(?:Name)?="([^"]+)"`),
    )?.[1] || source.match(
      new RegExp(`id="${id}" className=\\{stateClass\\('[^']+', '([^']+)'\\)\\}`),
    )?.[1];
    for (const id of stagedStates) {
      assert.equal(stateClasses(SHELL, id), stateClasses(LEGACY, id), `${id} class parity`);
    }

    for (const className of [
      'practice-feedback-header', 'practice-feedback-header__eyebrow',
      'practice-feedback-overview', 'practice-feedback-evidence',
      'practice-feedback-actions', 'practice-completion-eyebrow',
      'practice-mode-card__badge',
    ]) {
      const count = (source) => [...source.matchAll(new RegExp(`class(?:Name)?="[^"]*\\b${className}\\b`, 'g'))].length;
      assert.equal(count(SHELL), count(LEGACY), `${className} count parity`);
    }

    for (const copy of [
      'Linh hoạt', 'Gần phòng thi thật', 'Phản hồi tức thì',
      'Ưu tiên một điểm mạnh để giữ lại và một thay đổi nhỏ cho lượt nói tiếp theo.',
      'Bài nói của bạn', 'Đã ghi nhận đủ 3 Part', 'Tổng kết phiên',
    ]) {
      assert.match(LEGACY, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(SHELL, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  test('inline SVG geometry matches the pinned lucide 1.17.0 icon set', () => {
    const renderedNames = new Set([...SHELL.matchAll(/<Icon name="([^"]+)"/g)].map((match) => match[1]));
    assert.deepEqual(renderedNames, new Set(Object.keys(LUCIDE_1_17_ICON_SIGNATURES)));
    for (const [name, signatures] of Object.entries(LUCIDE_1_17_ICON_SIGNATURES)) {
      const block = SHELL.match(new RegExp(`case '${name}':([\\s\\S]*?)break;`))?.[1];
      assert.ok(block, `missing ${name} switch case`);
      for (const signature of signatures) assert.ok(block.includes(signature), `${name}: ${signature}`);
    }
  });

  test('App Router owns the URL and renders canonical chrome, native shell and guarded boot', () => {
    assert.match(PAGE, /<aver-chrome active="speaking"/);
    assert.match(PAGE, /<PracticePlayerBridge \/>/);
    assert.match(PAGE, /<PracticeRecorderBridge \/>/);
    assert.match(PAGE, /<PracticeSubmissionBridge \/>/);
    assert.match(PAGE, /<PracticeSessionBoot \/>/);
    assert.match(SHELL, /^'use client';/);
    assert.match(SHELL, /function callPractice/);
    assert.match(SHELL, /function Icon/);
    assert.match(PLAYER_BRIDGE, /<PracticePageShell player=\{controller \|\| INERT_PLAYER_STATE\} \/>/);
    assert.match(PLAYER_BRIDGE, /installPracticePlayerController\(window as any\)/);
    assert.match(PLAYER_LIFECYCLE, /domStateActivation: false/);
    assert.match(SHELL, /useSyncExternalStore/);
    assert.match(SHELL, /activeState === name/);
    assert.match(SHELL, /view\.header\.progressBarPercent/);
    assert.match(SHELL, /view\.prep\.cueBullets\.map/);
    assert.match(SHELL, /view\.recording\.playbackUrl/);
    assert.match(SHELL, /view\.processing\.text/);
    assert.match(SHELL, /view\.part2\.prepTimer/);
    assert.match(SHELL, /view\.part2\.speakTimer/);
    assert.match(SHELL, /view\.sheet\.slots\.map/);
    assert.match(SHELL, /view\.completion\.statusTone/);
    assert.match(SHELL, /view\.completion\.ctasVisible/);
    assert.match(SHELL, /callPractice\('sheetToggleRecording'/);
    assert.match(SHELL, /callPractice\('submitSheet'/);
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
    assert.match(BOOT, /player\.showState\('error'\)/);
    assert.match(BOOT, /practice_native_bootstrap_failed/);
  });

  test('the affinity floor keeps admission Legacy while the dark route stays ready', () => {
    const speaking = CORE_PLAYER_AFFINITY_POLICY.surfaces.speaking;
    assert.equal(speaking.next.path, '/practice/session');
    assert.equal(speaking.next.route_ready, true);
    assert.equal(speaking.admit_new, 'legacy');
    assert.match(
      DOC,
      /NATIVE BOOTSTRAP \+ RECORDER \+ SUBMISSION \+ FULL-TEST STATE \+[\s\S]{0,40}PLAYER LIFECYCLE/,
    );
    assert.match(DOC, /NATIVE JSX\/FEEDBACK\/PRONUNCIATION RENDERERS/);
    assert.match(DOC, /không dùng `dangerouslySetInnerHTML`/);
    assert.match(DOC, /`route_ready=true` chỉ xác nhận dark route/);
    assert.match(DOC, /`admit_new=legacy`/);
  });

  test('parity inventory includes the missing-session branch with an honest limitation', () => {
    const pair = PAIRS.find((item) => item.name === 'speaking-practice-dark');
    assert.equal(pair.legacy, '/pages/practice.html');
    assert.equal(pair.next, '/practice/session');
    assert.ok(pair.note.includes('THIẾU session_id'));
    assert.ok(pair.note.includes('không chứng minh'));
  });

  test('speaking-debt-only changes activate the authed parity pair', () => {
    const selectors = [...PARITY_GATE.matchAll(/grep -qE '([^']+)'/g)]
      .map((match) => match[1]);
    assert.equal(selectors.length, 2, 'expected full and authed scope selectors');
    const changed = 'frontend/public/js/speaking-debt.js';
    assert.match(PARITY_GATE, /- 'frontend\/public\/js\/speaking-debt\.js'/,
      'the workflow must start when only the debt retry path changes');
    assert.equal(new RegExp(selectors[1]).test(changed), true,
      'the exact changed filename must set authed=true, not run unrelated public parity only');
  });
});
