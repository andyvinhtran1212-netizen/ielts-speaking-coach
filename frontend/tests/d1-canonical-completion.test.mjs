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
    assert.match(source, /const storedIds = readActiveSessionIds\(\)/);
    assert.match(source, /const candidates = storedIds\.length \? storedIds : legacyIds/);
    assert.match(source, /sessionIdFromUrl\(\) \|\| candidates\[candidates\.length - 1\]/);
  });

  test('session registry is account-scoped and legacy ownership is proven before cleanup', () => {
    assert.match(source, /_userId = me\.id/);
    assert.match(source, /`\$\{ACTIVE_SESSION_KEY\}:\$\{_userId\}`/);
    assert.match(source, /const legacyIds = storedIds\.length \? \[\] : readActiveSessionIds\(ACTIVE_SESSION_KEY\)/);
    assert.match(source, /rememberActiveSession\(_session\.id\)[\s\S]{0,180}legacyIds\.includes\(_session\.id\)[\s\S]{0,100}removeItem\(ACTIVE_SESSION_KEY\)/);
    assert.match(source, /res\.status === 404[\s\S]{0,100}forgetActiveSession\(sessionId\)/);
  });

  test('a transient canonical resume failure blocks new-session creation', () => {
    assert.match(source, /if \(res\.status === 404\) \{[\s\S]{0,180}return false;[\s\S]{0,180}_showState\('error',[\s\S]{0,180}return true;/);
    assert.match(source, /active-session resume failed:[\s\S]{0,220}_showState\('error',[\s\S]{0,180}return true;/);
  });

  test('a completed stored session replays idempotent completion to recover its summary', () => {
    assert.match(source, /\['active', 'completed'\]\.includes\(session\.status\)/);
    assert.match(source, /session\.status === 'completed' \|\| attempts\.length >= exercises\.length[\s\S]{0,100}await showSummary\(\)/);
  });

  test('completion removes only its own registry entry in either tab order', () => {
    assert.match(source, /const completingSessionId = _session\.id/);
    assert.match(source, /function forgetActiveSession\(sessionId\)[\s\S]{0,240}filter\(id => id !== sessionId\)/);
    assert.match(source, /forgetActiveSession\(completingSessionId\)[\s\S]{0,80}renderSummaryScreen/);
    assert.match(source, /JSON\.stringify\(unique\)/);
    assert.doesNotMatch(source, /const summary = await res\.json\(\);\s*window\.localStorage\?\.removeItem/);
  });

  test('429 shows reset-aware retry and an exit affordance without unlocking Next', () => {
    assert.match(source, /res\.status === 429[\s\S]{0,300}_lastAttemptRateLimit/);
    assert.match(source, /formatQuotaMessage\(_lastAttemptRateLimit\)/);
    assert.match(source, /href="\/exercises">Rời phiên/);
  });
});
