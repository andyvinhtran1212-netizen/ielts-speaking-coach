/**
 * mock-live-console-boot.test.mjs — the invigilator console must stay LIVE.
 *
 * A bad ?exam_id= (unpublished, archived, typo) shows an error and asks the
 * admin to pick from the list. Returning early there wired only the picker: the
 * board then loaded ONCE on selection and silently went stale for the rest of
 * the exam, with "Làm mới" and the auto-refresh toggle both inert (Codex
 * review, PR #833).
 *
 * Source-sentinels — this is a boot-ordering property.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(
  join(__dirname, '..', 'public', 'js', 'admin-mock-live.js'), 'utf8');

describe('mock-live console — boot wiring survives a bad exam link', () => {
  test('the invalid-link branch no longer returns before wiring the controls', () => {
    // The early `return` inside the invalid branch was the bug.
    assert.doesNotMatch(JS, /show\('error'\);[\s\S]{0,400}?\n\s{6}return;\n\s{4}\}/);
    assert.match(JS, /show\('error'\);\n\s*\} else \{/);
  });

  test('picker / refresh / auto-refresh are wired on every path', () => {
    const boot = JS.slice(JS.indexOf('async function boot()'));
    const picker = boot.indexOf("el('exam-picker').addEventListener('change'");
    const refresh = boot.indexOf("el('refresh-now').addEventListener('click'");
    const auto = boot.indexOf("el('auto-refresh').addEventListener('change'");
    assert.ok(picker > 0 && refresh > picker && auto > refresh,
              'all three controls wired, once, in the shared path');
    // ...and only ONE picker handler now, not one per branch
    assert.equal(boot.split("el('exam-picker').addEventListener('change'").length - 1, 1);
  });

  test('selecting an exam from the picker restarts polling', () => {
    assert.match(JS, /show\('loading'\); load\(\); startPolling\(\);/);
  });

  test('polling is idempotent, so re-selecting cannot stack intervals', () => {
    assert.match(JS, /function startPolling\(\) \{\s*\n\s*if \(S\.poll\) clearInterval\(S\.poll\);/);
  });
});
