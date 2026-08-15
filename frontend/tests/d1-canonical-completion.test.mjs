import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'public', 'js', 'd1-exercise.js'), 'utf8');

describe('D1 canonical completion and quota recovery', () => {
  test('a failed completion ACK renders retry state instead of a local completed summary', () => {
    assert.match(source, /if \(!res\.ok\) \{\s*renderCompletionError\(\);\s*return;/);
    assert.match(source, /d1-complete-retry[\s\S]{0,500}onclick = showSummary/);
    assert.doesNotMatch(source, /complete-session failed; using local summary/);
  });

  test('active session survives exit and is resumed from the canonical session endpoint', () => {
    assert.match(source, /ACTIVE_SESSION_KEY = 'aver:d1:active-session'/);
    assert.match(source, /api\/exercises\/d1\/sessions\/\$\{sessionId\}/);
    assert.match(source, /window\.localStorage\?\.removeItem\(ACTIVE_SESSION_KEY\)[\s\S]{0,120}renderSummaryScreen/);
  });

  test('429 shows reset-aware retry and an exit affordance without unlocking Next', () => {
    assert.match(source, /res\.status === 429[\s\S]{0,300}_lastAttemptRateLimit/);
    assert.match(source, /formatQuotaMessage\(_lastAttemptRateLimit\)/);
    assert.match(source, /href="\/exercises">Rời phiên/);
  });
});
