import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BEHAVIOR = readFileSync(join(ROOT, 'app/(authed-full-test-result)/full-test-result/full-test-result-behavior.tsx'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'app/(authed-full-test-result)/full-test-result/page.tsx'), 'utf8');
const LAYOUT = readFileSync(join(ROOT, 'app/(authed-full-test-result)/layout.tsx'), 'utf8');
const PRACTICE = readFileSync(join(ROOT, 'public/js/practice.js'), 'utf8');
const BACKEND = readFileSync(join(ROOT, '../backend/routers/sessions.py'), 'utf8');

describe('/full-test-result — native ownership and safety', () => {
  test('uses AuthedShell and a declarative route without the legacy result bootstrap', () => {
    assert.match(LAYOUT, /<AuthedShell/);
    assert.match(LAYOUT, /\/css\/full-test-result\.css/);
    assert.match(PAGE, /<FullTestResultBehavior/);
    assert.doesNotMatch(PAGE + LAYOUT + BEHAVIOR, /full-test-result\.html|dangerouslySetInnerHTML|\.innerHTML\s*=/);
  });

  test('loads one canonical summary snapshot with keyed auth/query state and abort cleanup', () => {
    assert.match(BEHAVIOR, /fullTestSummaryPath\(\{ p1, p2, p3 \}\)/);
    assert.match(BEHAVIOR, /const requestKey = status === 'signed-in'/);
    assert.match(BEHAVIOR, /data\.session\.user\?\.id !== user\?\.id/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('renders sealed, failed and pending states separately from ready content', () => {
    assert.match(BEHAVIOR, /result\?\.sealed/);
    assert.match(BEHAVIOR, /result\?\.failed/);
    assert.match(BEHAVIOR, /result && !result\.ready/);
    assert.match(BEHAVIOR, /result\?\.ready/);
  });

  test('never triggers an AI pronunciation mutation while opening results', () => {
    assert.doesNotMatch(BEHAVIOR, /pronunciation\/full|method:\s*['"]POST/);
    assert.match(BACKEND, /_persisted_pronunciation_summary\(response_rows\)/);
  });

  test('PDF actions are guarded, abortable and report partial completion', () => {
    assert.match(BEHAVIOR, /if \(inFlight\.current\) return/);
    assert.match(BEHAVIOR, /controllers\.current\.forEach\(\(controller\) => controller\.abort\(\)\)/);
    assert.match(BEHAVIOR, /Đã tải \$\{completed\}\/\$\{view\.parts\.length\}/);
    assert.match(BEHAVIOR, /URL\.revokeObjectURL/);
  });
});

describe('/full-test-result — coexistence boundary', () => {
  test('Next player selects the native route while legacy keeps the rollback URL', () => {
    assert.match(PRACTICE, /var path = _getNativeView\(\) \? '\/full-test-result' : '\/pages\/full-test-result\.html'/);
    assert.match(PRACTICE, /_navigateTo\(_fullTestResultUrl\(_ftAllSessionIds\)\)/);
  });

  test('later parts identify only their predecessor and never mint an attempt id', () => {
    assert.match(PRACTICE, /_createBody\.previous_session_id = _sessionId/);
    assert.doesNotMatch(PRACTICE, /full_test_chain_id|_fullTestChainId/);
  });
});
