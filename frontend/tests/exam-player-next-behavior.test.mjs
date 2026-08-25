import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-exam)', 'exam', 'page.tsx');
const PLAYER = read('app', '(authed-exam)', 'exam', 'exam-player.tsx');
const LAYOUT = read('app', '(authed-exam)', 'layout.tsx');
const CSS = read('public', 'css', 'exam-player-next.css');
const VERIFIER = read('tooling', 'verify-exam-flow.mjs');

test('/exam is a native authenticated App Router player', () => {
  assert.match(PAGE, /<ExamPlayer \/>/);
  assert.match(PAGE, /<aver-chrome active="home"/);
  assert.match(LAYOUT, /<AuthedShell/);
  assert.match(LAYOUT, /exam-player-next\.css/);
  assert.doesNotMatch(`${PAGE}\n${PLAYER}`, /iframe|dangerouslySetInnerHTML|exam-player\.js|KPStepper/);
});

test('owns list, detail, answer, submit and caller-owned review contracts in React', () => {
  assert.match(PLAYER, /\/api\/exams\$\{/);
  assert.match(PLAYER, /\/api\/exams\/\$\{encodeURIComponent\(query\.id\)\}/);
  assert.match(PLAYER, /answersForSubmit\(exam, answers\)/);
  assert.match(PLAYER, /\/api\/exams\/\$\{encodeURIComponent\(exam\.id\)\}\/attempts/);
  assert.match(PLAYER, /\/api\/exams\/attempts\/\$\{encodeURIComponent\(id\)\}\/review/);
  assert.match(PLAYER, /normalizeExamReview/);
  assert.match(PLAYER, /Tải lại phần chữa bài/);
});

test('fails closed across auth/account changes and serializes the non-idempotent submit', () => {
  assert.match(PLAYER, /status === 'signed-out'/);
  assert.match(PLAYER, /window\.location\.replace\('\/login'\)/);
  assert.match(PLAYER, /accountRef\.current !== expectedAccount/);
  assert.match(PLAYER, /generationRef\.current !== generation/);
  assert.match(PLAYER, /submitLock\.current/);
  assert.match(PLAYER, /khóa gửi lại trên trang này để tránh tạo hai lượt làm bài/);
  assert.match(PLAYER, /setSubmitBlocked\(true\)/);
  assert.match(PLAYER, /disabled=\{busy \|\| submitBlocked \|\| Boolean\(attemptId\)\}/);
});

test('renders the KP stepper and reports micro-check persistence failure', () => {
  assert.match(PLAYER, /\/api\/kp\/microcheck-answers/);
  assert.match(PLAYER, /grammarKnowledgeHref/);
  assert.match(PLAYER, /Phân tích đáp án nhiễu/);
  assert.match(PLAYER, /item\?\.why_wrong_vi/);
  assert.match(PLAYER, /Chưa lưu được tiến độ/);
  assert.match(PLAYER, /aria-expanded/);
});

test('fixture browser owns the full interaction and responsive evidence', () => {
  assert.match(VERIFIER, /không có session thì fail closed/);
  assert.match(VERIFIER, /chỉ POST đúng một lượt/);
  assert.match(VERIFIER, /không submit lại khi review GET lỗi/);
  assert.match(VERIFIER, /payload sai contract fail closed/);
  assert.match(VERIFIER, /scrollWidth <= innerWidth/);
  assert.match(CSS, /@media \(max-width: 640px\)/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
});
