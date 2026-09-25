import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

test('listening hub is programme-first and uses the truthful title', () => {
  const shell = read('app', '(authed-listening)', 'listening', 'page-shell.tsx');
  const behavior = read('app', '(authed-listening)', 'listening', 'listening-landing-behavior.tsx');
  assert.match(shell, /<h1>Luyện nghe<\/h1>/);
  assert.doesNotMatch(shell, /Luyện nghe <span[^>]*>IELTS/);
  assert.match(behavior, /Tiếp tục từ lần trước/);
  assert.match(behavior, /Gợi ý tiếp theo/);
  assert.match(behavior, /ready && !ready\.resume/);
  assert.match(behavior, /Chọn chương trình luyện tập/);
  assert.match(behavior, /\/listening\/general/);
  assert.match(behavior, /\/listening\/ielts/);
  assert.match(behavior, /needsPermanentIeltsNavigation\(ready\.programmes\)/);
  assert.match(behavior, /Quick · Skills · Mini · Full Test/);
  assert.match(behavior, /slice\(0, 3\)/);
});

test('programme copy describes per-question learning without internal scoring labels', () => {
  const landing = read('app', '(authed-listening)', 'listening', 'listening-landing-behavior.tsx');
  const ielts = read('app', '(authed-listening)', 'listening', 'ielts', 'page.tsx');
  assert.match(landing, /đối chiếu ngay từng câu/);
  assert.match(ielts, /đối chiếu từng câu/);
  assert.match(ielts, /không tính band IELTS/);
  assert.doesNotMatch(landing + ielts, /report-only/);
});

test('programme runner autosaves and routes to self-review', () => {
  const runner = read('app', '(authed-listening-player)', 'listening', 'programmes', 'form', '[testId]', 'programme-form-runner.tsx');
  assert.match(runner, /patchWith\(`\/api\/listening\/tests\/attempts\/\$\{attemptId\}\/answers`/);
  assert.match(runner, /scoring_policy !== 'report_only'/);
  assert.match(runner, /Hoàn thành và xem lại/);
  assert.ok(runner.includes('/guided-state'));
  assert.ok(runner.includes('/reveal'));
  assert.match(runner, /await queue\.flush\(\[\{ qNum, value \}\]\)/);
  assert.match(runner, /\/listening\/programmes\/result\/\$\{state\.attemptId\}/);
  assert.match(runner, /createProgrammeAnswerWriteQueue/);
  assert.match(runner, /createProgrammeAnswerDraftStore/);
  assert.match(runner, /draftStore\.current\?\.remember\(qNum, value\)/);
  assert.match(runner, /setAnswers\(\{ \.\.\.restored, \.\.\.recovered \}\)/);
  assert.match(runner, /store\.clearIfCurrent\(qNum, value\)/);
  assert.match(runner, /draftStore\.current\?\.clear\(\)/);
  assert.doesNotMatch(runner, /attempts\/in-progress\?standalone=true/);
  assert.match(runner, /attempts\?standalone=true/);
  assert.match(runner, /\?attempt_id=\$\{encodeURIComponent\(attemptId\)\}/);
  assert.match(runner, /\/playback-started/);
  assert.match(runner, /startProgrammeOncePlayback/);
  assert.match(runner, /attempt\.playback_started_at \|\| \(replayPolicy === 'once' && !audioUrl\) \? 'done' : 'ready'/);
  assert.doesNotMatch(runner, /listening-once:/);
  assert.match(runner, /queue\.flush\(programmeAnswerFlushEntries\(state\.form\.questions, answers\)\)/);
  assert.match(runner, /submitLock\.current = true/);
  assert.match(runner, /disabled=\{submitting \|\| revealing\}/);
  assert.match(runner, /onceState === 'playing'/);
  assert.match(runner, /Tạm dừng/);
  assert.match(runner, /onEnded=\{\(\) => setOnceState\('done'\)\}/);
});

test('programme pages consume generated OpenAPI wire contracts', () => {
  const contracts = read('lib', 'listening-programmes-api.ts');
  assert.match(contracts, /ApiGetJson<'\/api\/listening\/overview'>/);
  assert.match(contracts, /ApiGetJson<'\/api\/listening\/programmes\/\{programme_id\}\/lessons'>/);
  assert.match(contracts, /ApiGetJson<'\/api\/listening\/lessons\/\{lesson_id\}'>/);
  assert.match(contracts, /ApiGetJson<'\/api\/listening\/tests\/\{test_id\}'>/);
  assert.match(contracts, /ApiGetJson<'\/api\/listening\/tests\/attempts\/\{attempt_id\}\/review'>/);
});

test('report-only result never presents an IELTS band', () => {
  const result = read('app', '(authed-listening-review)', 'listening', 'programmes', 'result', '[attemptId]', 'programme-result.tsx');
  assert.match(result, /Đây không phải điểm IELTS/);
  assert.match(result, /Câu tự đối chiếu/);
  assert.doesNotMatch(result, /band_estimate|Band [0-9]/);
  assert.match(result, /createProgrammeReplayController/);
  assert.match(result, /replayController\.current\?\.dispose\(\)/);
});

test('historical results return to the current programme library, not an archived lesson', () => {
  const result = read('app', '(authed-listening-review)', 'listening', 'programmes', 'result', '[attemptId]', 'programme-result.tsx');
  assert.match(result, /programmeLibraryPath = result\.programmeId === 'general-listening-practice' \? '\/listening\/general' : result\.programmeId === 'ielts-listening-practice' \? '\/listening\/ielts' : '\/listening'/);
  assert.match(result, /href=\{programmeLibraryPath\}>← Thư viện chương trình/);
  assert.doesNotMatch(result, /href=\{result\.lessonId/);
});

test('programme UI has complete loading error empty and partial-data states', () => {
  const library = read('app', '(authed-listening)', 'listening', 'programme-library.tsx');
  assert.match(library, /Đang tải bài học/);
  assert.match(library, /Không tải được thư viện/);
  assert.match(library, /Chưa có bài học ở trạng thái này/);
  assert.match(library, /Tiến độ có thể chưa đầy đủ/);
  assert.match(library, /`\/listening\/\$\{programmePath\}\/\$\{lesson\.id\}`/);
  assert.match(library, /showIeltsModes/);
  assert.match(library, /IELTS_MODES/);
  assert.match(library, /lessonError/);
  const detail = read('app', '(authed-listening)', 'listening', 'lessons', '[lessonId]', 'lesson-detail.tsx');
  assert.match(detail, /duration_seconds/);
  assert.match(detail, /checked_item_count/);
  assert.match(detail, /self_review_item_count/);
  assert.match(detail, /support_policy/);
});

test('General programme copy never hard-codes a canonical lesson count', () => {
  const page = read('app', '(authed-listening)', 'listening', 'general', 'page.tsx');
  assert.match(page, /Các bài học theo tình huống/);
  assert.doesNotMatch(page, /56 bài học/);
});
