import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const config = readFileSync(new URL('../playwright.gate-e.config.js', import.meta.url), 'utf8');
const spec = readFileSync(new URL('./gate-e/native-speaking-fixtures.spec.js', import.meta.url), 'utf8');
const harness = readFileSync(new URL('./gate-e/native-speaking-harness.js', import.meta.url), 'utf8');
const recoverySpec = readFileSync(
  new URL('./gate-e/native-speaking-resume-finalize.spec.js', import.meta.url),
  'utf8',
);
const workflow = readFileSync(new URL('../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('Gate E browser evidence uses a production build and bundled Chromium without retries', () => {
  assert.match(config, /retries:\s*0/);
  assert.match(config, /command:\s*'npm run build && npm run start'/);
  assert.match(config, /use:\s*\{ browserName: 'chromium' \}/);
  assert.doesNotMatch(config, /channel:\s*'chrome'/);
  assert.equal(pkg.scripts['test:e2e:gate-e'], 'playwright test -c playwright.gate-e.config.js');
});

test('Gate E failure evidence has a dedicated HTML report plus traces and screenshots', () => {
  assert.match(config, /outputDir:\s*'test-results\/gate-e'/);
  assert.match(config, /outputFolder:\s*'playwright-report\/gate-e'/);
  assert.match(config, /\['html'/);
  assert.match(workflow, /playwright-e2e-failure-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /timeout-minutes:\s*15/);
  assert.match(workflow, /frontend\/playwright-report/);
  assert.match(workflow, /frontend\/test-results/);
  assert.match(workflow, /if-no-files-found:\s*error/);
});

test('Speaking fixtures mock only pinned dependencies and use canonical attempt identity', () => {
  assert.match(harness, /const SUPABASE_CDN = 'https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.107\.0\/dist\/umd\/supabase\.min\.js'/);
  assert.match(harness, /const LUCIDE_CDN = 'https:\/\/unpkg\.com\/lucide@1\.17\.0'/);
  assert.match(harness, /page\.route\(SUPABASE_CDN/);
  assert.match(harness, /page\.route\(LUCIDE_CDN/);
  assert.doesNotMatch(harness, /cdn\.jsdelivr\.net\/\*\*/);
  assert.doesNotMatch(harness, /unpkg\.com\/\*\*/);
  assert.match(spec, /full_test_attempt_id/);
  assert.match(recoverySpec, /full_test_attempt_id/);
  assert.doesNotMatch(spec, /full_test_chain_id/);
  assert.doesNotMatch(recoverySpec, /full_test_chain_id/);
  assert.equal((spec.match(/^test\('/gm) || []).length, 6);
  assert.equal((recoverySpec.match(/^test\('/gm) || []).length, 4);
});
