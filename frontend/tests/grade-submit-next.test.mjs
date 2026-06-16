/**
 * grade-submit-next.test.mjs — grade-flow PR-3.
 *
 * grade.html "Lưu & bài kế" + "← Quay lại queue": navigation-only over the
 * sessionStorage queue-context written by queue.html (PR-2). Pins: buttons
 * hidden by default (direct-open degrade), save-then-next reuses handleSave,
 * robust next via recomputed index, last-in-queue → back to queue, and that
 * NO grade-logic / .aw-* layout was changed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const H = read('pages', 'admin', 'writing', 'grade.html');


describe('grade submit-&-next — markup (hidden by default → direct-open degrade)', () => {
  test('btn-save-next + btn-back-queue exist and are hidden by default', () => {
    assert.match(H, /id="btn-save-next"[^>]*hidden/);
    assert.match(H, /id="btn-back-queue"[^>]*hidden/);
  });
  test('back link points to the queue page', () => {
    assert.match(H, /id="btn-back-queue"[^>]*href="\/pages\/admin\/writing\/queue\.html"/);
  });
});


describe('grade submit-&-next — reads the PR-2 queue-context', () => {
  test('reads sessionStorage gradeQueue {ids,…}', () => {
    assert.match(H, /var QUEUE_KEY = 'gradeQueue'/);
    assert.match(H, /sessionStorage\.getItem\(QUEUE_KEY\)/);
    assert.match(H, /Array\.isArray\(q\.ids\)/);
  });
  test('next is recomputed from _essayId (a stored index may be stale)', () => {
    assert.match(H, /function _nextEssayId[\s\S]*?q\.ids\.indexOf\(_essayId\)/);
  });
});


describe('grade submit-&-next — behaviour', () => {
  test('save-&-next reuses handleSave(), then navigates', () => {
    assert.match(H, /async function handleSaveNext[\s\S]*?await handleSave\(\)/);
    assert.match(H, /function handleSaveNext[\s\S]*?if \(!ok\) return;/);   // save fail → no nav
  });
  test('has next → go to next essay; last in queue → back to queue', () => {
    assert.match(H, /handleSaveNext[\s\S]*?grade\.html\?essay_id='\s*\+\s*encodeURIComponent\(nxt\)/);
    assert.match(H, /handleSaveNext[\s\S]*?else\s*\{[\s\S]*?writing\/queue\.html/);
  });
  test('controls revealed ONLY when this essay is in the queue-context', () => {
    assert.match(H, /function _initQueueNav[\s\S]*?q\.ids\.indexOf\(_essayId\) !== -1/);
    assert.match(H, /back\.hidden = !inQueue/);
    assert.match(H, /next\.hidden = !inQueue/);
  });
  test('wired + initialised in bootstrap onReady', () => {
    assert.match(H, /getElementById\('btn-save-next'\)\.addEventListener\('click', handleSaveNext\)/);
    assert.match(H, /_initQueueNav\(\);/);
  });
});


describe('grade submit-&-next — grade-logic untouched (navigation-only)', () => {
  test('handleSave still PATCHes /feedback (unchanged save path)', () => {
    assert.match(H, /window\.api\.patch\('\/admin\/writing\/essays\/'\s*\+\s*_essayId\s*\+\s*'\/feedback'/);
  });
  test('still the .aw-* island (no aver-design admin-components migration)', () => {
    assert.match(H, /admin-writing-grade\.css/);
    assert.doesNotMatch(H, /aver-design\/admin-components\.css/);
  });
});
