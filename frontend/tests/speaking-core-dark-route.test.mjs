/** Gate E Speaking: stable App Router dark URL without a false native/cutover claim. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractLegacyPracticeBody } from '../lib/legacy-practice-shell.mjs';
import { CORE_PLAYER_AFFINITY_POLICY } from '../lib/core-player-affinity.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const readFrontend = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const readRoot = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');

const LEGACY = readFrontend('public', 'pages', 'practice.html');
const PAGE = readFrontend('app', '(authed-practice)', 'practice', 'session', 'page.tsx');
const SHELL = readFrontend('app', '(authed-practice)', 'practice', 'session', 'legacy-practice-shell.tsx');
const BOOT = readFrontend('app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx');
const LAYOUT = readFrontend('app', '(authed-practice)', 'layout.tsx');
const PAIRS = JSON.parse(readFrontend('tooling', 'parity-pairs-authed.json'));
const DOC = readRoot('docs', 'GATE_E_SPEAKING_CORE_2026-08-09.md');
const PARITY_GATE = readRoot('.github', 'workflows', 'parity-gate.yml');

describe('/practice/session transitional dark route', () => {
  test('extracts the real legacy body but never duplicates chrome or scripts', () => {
    const markup = extractLegacyPracticeBody(LEGACY);
    assert.doesNotMatch(markup, /<aver-chrome\b[^>]*><\/aver-chrome>/);
    assert.doesNotMatch(markup, /<script\b/i);
    for (const state of [
      'loading', 'error', 'mode-choice', 'prep', 'p2a', 'p2b', 'p2c',
      'processing', 'feedback', 'test-results', 'completion', 'sheet',
    ]) {
      assert.match(markup, new RegExp(`id="state-${state}"`), state);
    }
    assert.match(markup, /PracticeApp\.submitRecording\(\)/);
    assert.match(markup, /PracticeApp\.finishSession\(\)/);
  });

  test('extractor fails closed on drift or script leakage', () => {
    assert.throws(() => extractLegacyPracticeBody(''), /source-missing/);
    assert.throws(
      () => extractLegacyPracticeBody('<body><aver-chrome></aver-chrome><script>x</script><!-- ─── SCRIPTS'),
      /script-leaked/,
    );
    assert.throws(
      () => extractLegacyPracticeBody('<body><main></main><!-- ─── SCRIPTS'),
      /chrome-boundary-invalid/,
    );
  });

  test('App Router owns the URL and renders canonical chrome, shell and guarded boot', () => {
    assert.match(PAGE, /<aver-chrome active="speaking"/);
    assert.match(PAGE, /<LegacyPracticeShell \/>/);
    assert.match(PAGE, /<PracticeSessionBoot \/>/);
    assert.match(SHELL, /extractLegacyPracticeBody\(source\)/);
    assert.match(SHELL, /dangerouslySetInnerHTML/);
    assert.match(SHELL, /suppressHydrationWarning/);
    assert.match(SHELL, /display: 'contents'/);
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
    assert.match(DOC, /NATIVE BOOTSTRAP \+ RECORDER; LEGACY ORCHESTRATION; ADMISSION/);
    assert.match(DOC, /Upload\/grading\/player\s+state machine vẫn ở `practice\.js`/);
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
