/**
 * mock-exam-embed-autoclick.test.mjs — the iframe auto-click in mock-exam-hook.
 *
 * The mock runner embeds the Listening/Reading pages in an iframe and presses
 * their entry button for the student. Two things must hold or a refresh mid-
 * exam strands them on the pre-start screen:
 *
 *   · a DISABLED button is not actionable — the Listening runner disables Start
 *     while the resume lookup is still unknown, and clicking it is a no-op that
 *     used to clear the poller for good
 *   · once Resume is on screen it is the ONLY button that may be pressed, even
 *     while disabled — Start abandons the open attempt
 *
 * Source-sentinels.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = readFileSync(
  join(__dirname, '..', 'public', 'js', 'mock-exam-hook.js'), 'utf8');

describe('mock-exam-hook — embed auto-click', () => {
  test('never clicks a disabled button, keeps polling instead', () => {
    assert.match(HOOK, /if \(btn && !btn\.disabled\) \{ btn\.click\(\); clearInterval\(iv\); \}/);
  });

  test('give-up window outlasts the resume-lookup retry (3s) rounds', () => {
    const m = HOOK.match(/tries > (\d+)\) clearInterval\(iv\)/);
    assert.ok(m, 'give-up guard present');
    assert.ok(Number(m[1]) * 200 >= 15000, 'at least ~15s of polling');
  });

  test('Resume on screen blocks the fall-through to Start', () => {
    assert.match(HOOK, /var btn = onScreen\(resume\) \? resume : \(onScreen\(start\) \? start : null\)/);
  });
});
