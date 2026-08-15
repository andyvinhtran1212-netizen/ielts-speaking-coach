import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const page = read('app', '(authed-d1-exercise)', 'd1-exercise', 'page.tsx');
const player = read('app', '(authed-d1-exercise)', 'd1-exercise', 'd1-exercise-player.tsx');
const layout = read('app', '(authed-d1-exercise)', 'layout.tsx');
const hub = read('public', 'js', 'vocab-modules', 'exercises.js');

describe('/d1-exercise native ownership', () => {
  test('owns a student-shell route without loading the legacy IIFE', () => {
    assert.match(page, /<D1ExercisePlayer/);
    assert.match(page, /<aver-chrome active="vocabulary"/);
    assert.match(layout, /<AuthedShell pageStylesheets=\{\['\/css\/d1-exercise-next\.css'\]\}/);
    assert.doesNotMatch(page + player + layout, /d1-exercise\.js/);
  });

  test('is account-keyed, feature-gated and restores a canonical session snapshot', () => {
    assert.match(player, /const accountKey = status === 'signed-in'/);
    assert.match(player, /accountRef\.current/);
    assert.match(player, /mutationLock\.current = false/);
    assert.match(player, /window\.api\.get<any>\('\/auth\/me'\)/);
    assert.match(player, /normalizeD1Resume/);
    assert.match(player, /firstUnansweredIndex/);
    assert.match(player, /aver:d1:active-session/);
    assert.match(player, /JSON\.parse\(raw\)/);
    assert.match(player, /writeSessionIds\(userId, readSessionIds\(userId\)\.filter\(\(id\) => id !== sessionId\)\)/);
    assert.match(player, /queryId \|\| storedIds\[storedIds\.length - 1\]/);
  });

  test('account changes reset question state and retain a late start ACK for its owner', () => {
    assert.match(player, /setSession\(null\)[\s\S]{0,220}setIndex\(0\)[\s\S]{0,120}setChoice\(null\)[\s\S]{0,120}setAttemptKey\(''\)[\s\S]{0,120}setAttemptAck\(null\)[\s\S]{0,120}setSaveError\(''\)/);
    assert.match(player, /const started = normalizeD1Start\(payload\)[\s\S]{0,420}retainSession\(expectedAccount, started\.sessionId\);\s*if \(accountRef\.current !== expectedAccount\) return;/);
    assert.match(player, /function retainSession\(userId: string, sessionId: string\)[\s\S]{0,180}writeSessionIds\(userId/);
  });

  test('retries one stable client key and gates Next on canonical ACK', () => {
    assert.match(player, /client_attempt_id: key/);
    assert.match(player, /for \(let attempt = 0; attempt < 2 && !canonical/);
    assert.match(player, /normalizeD1AttemptAck\(payload, exercise, selected\)/);
    assert.match(player, /const canAdvance = answered && \(reviewMode \|\| !!attemptAck\) && !busy/);
    assert.match(player, /persistAnswer\(choice, attemptKey\)/);
  });

  test('uses canonical completion and keeps revision local-only', () => {
    assert.match(player, /normalizeD1Summary/);
    assert.match(player, /reviewMode\) return/);
    assert.match(player, /Đây là lượt ôn tập, không ghi thêm attempt/);
    assert.doesNotMatch(player, /dangerouslySetInnerHTML/);
  });

  test('keeps quota exhaustion recoverable without unlocking Next', () => {
    assert.match(player, /caught\?\.status === 429[\s\S]{0,80}break/);
    assert.match(player, /setAttemptRateLimited\(rateLimited\)/);
    assert.match(player, /attemptRateLimited \? <a className="btn-ghost" href="\/exercises">Rời phiên<\/a>/);
    assert.match(player, /phase === 'rate_limited'[\s\S]{0,500}>Thử lại<[\s\S]{0,300}>Về Exercises</);
    assert.match(player, /detail\?\.reset_at[\s\S]{0,180}toLocaleString\('vi-VN'\)/);
  });

  test('exercise hub sends new sessions to Next while retaining HTML rollback', () => {
    assert.match(hub, /href="\/d1-exercise"/);
    assert.doesNotMatch(hub, /href="\/pages\/d1-exercise\.html"/);
  });
});
