import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const config = readFileSync(new URL('../playwright.speaking-regression.config.js', import.meta.url), 'utf8');
const spec = readFileSync(new URL('./speaking-regression/native-speaking-fixtures.spec.js', import.meta.url), 'utf8');
const harness = readFileSync(new URL('./speaking-regression/native-speaking-harness.js', import.meta.url), 'utf8');
const recoverySpec = readFileSync(
  new URL('./speaking-regression/native-speaking-resume-finalize.spec.js', import.meta.url),
  'utf8',
);
const workflow = readFileSync(new URL('../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('Speaking browser regression uses a production build and bundled Chromium without retries', () => {
  assert.match(config, /retries:\s*0/);
  assert.match(config, /command:\s*'npm run build && npm run start'/);
  assert.match(config, /use:\s*\{ browserName: 'chromium' \}/);
  assert.doesNotMatch(config, /channel:\s*'chrome'/);
  assert.match(config, /AVER_ENVIRONMENT:\s*'test'/);
  assert.match(config, /AVER_API_BASE:\s*'http:\/\/localhost:8000'/);
  assert.equal(pkg.scripts['test:e2e:speaking-regression'], 'playwright test -c playwright.speaking-regression.config.js');
});

test('Speaking browser regression has a dedicated HTML report plus traces and screenshots', () => {
  assert.match(config, /outputDir:\s*'test-results\/speaking-regression'/);
  assert.match(config, /outputFolder:\s*'playwright-report\/speaking-regression'/);
  assert.match(config, /\['html'/);
  assert.match(workflow, /playwright-e2e-failure-\$\{\{ github\.run_id \}\}/);
  // Three production-browser projects share this job; keep a bounded but
  // realistic ceiling for the expanded Chromium + WebKit evidence matrix.
  assert.match(workflow, /timeout-minutes:\s*20/);
  assert.match(workflow, /frontend\/playwright-report/);
  assert.match(workflow, /frontend\/test-results/);
  assert.match(workflow, /if-no-files-found:\s*error/);
});

test('Speaking fixtures mock only pinned same-origin runtimes and use canonical attempt identity', () => {
  assert.match(harness, /const SUPABASE_RUNTIME = `\$\{ORIGIN\}\/vendor\/supabase\.js`/);
  assert.match(harness, /const LUCIDE_RUNTIME = `\$\{ORIGIN\}\/vendor\/lucide\.min\.js`/);
  assert.match(harness, /page\.route\(SUPABASE_RUNTIME/);
  assert.match(harness, /page\.route\(LUCIDE_RUNTIME/);
  assert.doesNotMatch(harness, /SUPABASE_LEGACY_CDN|cdn\.jsdelivr\.net|unpkg\.com/);
  assert.match(spec, /full_test_attempt_id/);
  assert.match(recoverySpec, /full_test_attempt_id/);
  assert.doesNotMatch(spec, /full_test_chain_id/);
  assert.doesNotMatch(recoverySpec, /full_test_chain_id/);
  assert.equal((spec.match(/^test\('/gm) || []).length, 7);
  assert.equal((recoverySpec.match(/^test\('/gm) || []).length, 7);
});
