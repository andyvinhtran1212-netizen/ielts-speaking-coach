import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const execFileAsync = promisify(execFile);
const SUITES = ['anti-flash-iife-canonical', 'theme-toggle-icon-canonical', 'b8-frontend-polish']
  .map((name) => `frontend/tests/${name}.test.mjs`);

// Explicit inputs, not a copy of frontend/public or a fallback into the repo.
// Non-Pricing inputs are fresh current-source copies, never archived fixtures.
const SOURCES = [
  ...SUITES,
  ...['loader.mjs', 'manifest.json', 'pricing.html']
    .map((name) => `frontend/tests/fixtures/gate-f-pricing/${name}`),
  ...['home', 'speaking', 'practice', 'result', 'writing-dashboard', 'writing-result',
    'full-test-result', 'vocabulary', 'flashcards', 'exercises', 'profile',
    'grammar-roadmap', 'grammar-article', 'grammar-search', 'grammar-compare']
    .map((name) => `frontend/pages/${name}.html`),
  ...['index', 'new', 'status', 'prompts', 'assignments', 'instructor-queue', 'grade']
    .map((name) => `frontend/pages/admin/writing/${name}.html`),
  'frontend/pages/admin/students/index.html',
  ...['onboarding', 'index', 'admin', 'grammar'].map((name) => `frontend/${name}.html`),
  ...['home', 'speaking', 'practice', 'result', 'writing-dashboard', 'writing-result',
    'full-test-result', 'vocabulary', 'flashcards', 'exercises', 'profile', 'onboarding', 'index']
    .map((name) => `frontend/css/${name}.css`),
  'frontend/css/aver-design/DESIGN_SYSTEM.md',
  'frontend/js/components/aver-chrome.js',
  'frontend/js/practice.js',
];

test('shared suites pass without public Pricing but each still rejects a non-Pricing source regression', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aver-pricing-shared-'));
  try {
    for (const source of SOURCES) {
      const target = path.join(root, source);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(ROOT, source), target);
    }
    for (const absent of ['frontend/public', 'frontend/pricing.html', 'frontend/css/pricing.css',
      'frontend/tests/fixtures/gate-f-pricing/index.html',
      'frontend/tests/fixtures/gate-f-pricing/pricing.css']) {
      assert.equal(existsSync(path.join(root, absent)), false, `${absent} must not exist`);
    }
    // No worker state, NODE_OPTIONS, credentials, node_modules or source symlinks.
    const env = Object.fromEntries(['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT',
      'WINDIR', 'CI', 'LANG', 'LC_ALL', 'TZ'].filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]));
    const options = { cwd: root, env, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 };
    const { stdout } = await execFileAsync(process.execPath,
      ['--test', '--test-reporter=tap', ...SUITES], options);
    assert.ok(Number(stdout.match(/^# pass (\d+)$/m)?.[1]) >= 209,
      'Expected all 179 anti-flash, 26 theme and four polish cases');
    assert.match(stdout, /^# fail 0$/m);
    assert.match(stdout, /^# cancelled 0$/m);
    assert.match(stdout, /^# skipped 0$/m);
    assert.match(stdout, /^# todo 0$/m);

    // Mutate only disposable copies. Each suite must retain current-source
    // checks rather than silently extending its archive branch to other pages.
    const controls = [
      { file: 'frontend/pages/home.html', suite: SUITES[0],
        failure: /IIFE must read localStorage 'av-theme'/ },
      { file: 'frontend/index.html', suite: SUITES[1],
        failure: /theme toggle missing canonical class="icon-sun"/ },
      { file: 'frontend/pages/result.html', suite: SUITES[2],
        failure: /not ok \d+ - result\.html uses _toast/ },
    ];
    for (const { file, suite, failure } of controls) {
      writeFileSync(path.join(root, file), '<html></html>');
      await assert.rejects(execFileAsync(process.execPath,
        ['--test', '--test-reporter=tap', suite], options), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, failure);
        assert.match(error.stdout, /^# fail [1-9]\d*$/m);
        return true;
      });
      copyFileSync(path.join(ROOT, file), path.join(root, file));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
