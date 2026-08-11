/**
 * Regression gate for the `/speaking/result` native React behavior batch.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-speaking-result)', 'speaking', 'result', 'page.tsx');
const BEHAVIOR = read(
  'app', '(authed-speaking-result)', 'speaking', 'result', 'speaking-result-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');
const MOCK_RESULT = read('public', 'js', 'mock-result.js');

describe('/speaking/result — native React behavior', () => {
  test('does not inject the legacy module or watchdog', () => {
    assert.doesNotMatch(PAGE, /import\s+.*watchdogScript|<script|dangerouslySetInnerHTML/);
    assert.doesNotMatch(BEHAVIOR, /import\s*\([^)]*speaking-result\.js|<script|dangerouslySetInnerHTML/);
  });

  test('is no longer classified as a hard-navigation-only target', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/speaking\/result['"]/);
  });

  test('uses shared auth, keyed state and abortable requests', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /resultState\?\.key === requestKey/);
    assert.match(BEHAVIOR, /`\$\{user\.id\}:\$\{sittingId\}`/);
    assert.match(BEHAVIOR, /\[requestKey, sittingId\]/);
  });

  test('reads the canonical released-result endpoint and reports both gates', () => {
    assert.match(BEHAVIOR, /window\.api\.getWith<ResultPayload>/);
    assert.match(BEHAVIOR, /`\/api\/mock-exams\/sittings\/\$\{encodeURIComponent\(sittingId\)\}\/result`/);
    assert.match(BEHAVIOR, /Thiếu mã lượt thi\./);
    assert.match(BEHAVIOR, /Lượt thi này không có nhận xét Speaking\./);
  });

  test('renders all authored sections declaratively without raw HTML', () => {
    assert.match(BEHAVIOR, /Fluency & Coherence/);
    assert.match(BEHAVIOR, /Trung bình lớp/);
    assert.match(BEHAVIOR, /Cách luyện: \{section\.advice\}/);
    assert.doesNotMatch(BEHAVIOR, /\.innerHTML\s*=|__html/);
  });
});

describe('/speaking/result — canonical entry point', () => {
  test('TRF links to the canonical route, never the rollback HTML', () => {
    assert.match(MOCK_RESULT, /href:\s*'\/speaking\/result\?sitting='/);
    assert.doesNotMatch(MOCK_RESULT, /\/pages\/speaking-result\.html\?sitting=/);
  });
});
