import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PLAYER = read('app', '(authed-listening-practice-run)', 'listening', 'practice-run', 'practice-run-player.tsx');
const PAGE = read('app', '(authed-listening-practice-run)', 'listening', 'practice-run', 'page.tsx');
const LAYOUT = read('app', '(authed-listening-practice-run)', 'layout.tsx');
const LIBRARY = read('app', '(authed-listening)', 'listening', 'practice', 'listening-practice-behavior.tsx');
const CSS = read('public', 'css', 'listening-practice-run-next.css');
const PARITY = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/listening/practice-run native ownership', () => {
  test('owns an authenticated App Router page with the audio dependency', () => {
    assert.match(PAGE, /ListeningPracticeRun/);
    assert.match(LAYOUT, /AuthedShell/);
    assert.match(LAYOUT, /listening-practice-run-next\.css/);
    assert.match(LAYOUT, /audio-player\.js/);
    assert.match(LIBRARY, /href=\{`\/listening\/practice-run\?id=\$\{encodeURIComponent\(test\.id\)\}`\}/);
  });

  test('loads abortably and binds every render to account plus test identity', () => {
    assert.match(PLAYER, /key=\{`\$\{user\.id\}:\$\{params\.testId\}`\}/);
    assert.match(PLAYER, /controller\.abort\(\)/);
    assert.match(PLAYER, /generationRef\.current === generation/);
    assert.match(PLAYER, /accountRef\.current === accountId/);
    assert.match(PLAYER, /noRedirect:\s*true/);
    assert.doesNotMatch(PLAYER, /window\.location\.search/);
  });

  test('resumes before destructive start and reconciles an ambiguous start ACK', () => {
    const ensure = PLAYER.split('const ensureAttempt')[1].split('const submitWithReconciliation')[0];
    assert.ok(ensure.indexOf('readOpenAttempt') < ensure.indexOf('/attempts`, {}'));
    assert.match(ensure, /catch \(startError\)[\s\S]*readOpenAttempt/);
    assert.match(ensure, /practice-run-start-uncertain/);
    assert.match(PLAYER, /không tự tạo lại để tránh xoá tiến độ/i);
  });

  test('locks an ambiguous check to the exact first-answer payload', () => {
    assert.match(PLAYER, /type PendingCheck = \{ qNum: number; answer: string; reveal: boolean \}/);
    assert.match(PLAYER, /setPendingCheck\(request\)/);
    assert.match(PLAYER, /Thử chấm lại đúng câu trả lời này/);
    assert.match(PLAYER, /disabled=\{busy \|\| settled \|\| Boolean\(pendingCheck\)\}/);
    assert.match(PLAYER, /canonicalCorrect/);
  });

  test('never blindly retries submit and uses the owner-only GET reconciliation', () => {
    const submit = PLAYER.split('const submitWithReconciliation')[1].split('const applySubmitOutcome')[0];
    assert.match(submit, /\/submit/);
    assert.match(submit, /\/api\/listening\/tests\/attempts\/\$\{encodeURIComponent\(id\)\}`/);
    assert.match(submit, /canonical\.status === 'submitted'/);
    assert.match(PLAYER, /Hệ thống sẽ không tự gửi lại để tránh nộp hai lần/);
    assert.match(PLAYER, /Nộp lại sau khi đã đối chiếu/);
  });

  test('keeps first-answer score copy, reveal gate and question audio loop visible', () => {
    assert.match(PLAYER, /wrongTries >= 2/);
    assert.match(PLAYER, /auto-loop=\{looping \? 'true'/);
    assert.match(PLAYER, /lần trả lời đầu chưa đúng/);
    assert.match(PLAYER, /Điểm chỉ dùng câu trả lời đầu tiên/);
    assert.match(PLAYER, /Cũng chấp nhận/);
  });

  test('renders authored/backend text through React and ships responsive token CSS', () => {
    assert.doesNotMatch(PLAYER, /dangerouslySetInnerHTML|innerHTML|eval\(/);
    assert.match(CSS, /@media \(max-width: 640px\)/);
    assert.match(CSS, /prefers-reduced-motion/);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(PARITY, /verify-listening-practice-run-flow\.mjs/);
  });
});
