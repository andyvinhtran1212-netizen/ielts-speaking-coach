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
    assert.match(player, /requestForAccount\(expectedAccount, '\/auth\/me', ownsGeneration, \{ signal: controller\.signal \}\)/);
    assert.match(player, /normalizeD1Resume/);
    assert.match(player, /firstUnansweredIndex/);
    assert.match(player, /aver:d1:active-session/);
    assert.match(player, /JSON\.parse\(raw\)/);
    assert.match(player, /writeSessionIds\(userId, readSessionIds\(userId\)\.filter\(\(id\) => id !== sessionId\)\)/);
    assert.match(player, /const candidates = \[\.\.\.new Set\(\[[\s\S]{0,160}queryId,[\s\S]{0,120}\.\.\.\[\.\.\.storedIds\]\.reverse\(\),[\s\S]{0,120}\.\.\.\[\.\.\.legacyIds\]\.reverse\(\)/);
    assert.match(player, /for \(const candidate of candidates\)[\s\S]{0,500}caught\?\.status !== 404[\s\S]{0,100}clearResume\([\s\S]{0,80}expectedAccount,[\s\S]{0,80}candidate/);
    assert.match(player, /legacyIds\.includes\(resumedId\)[\s\S]{0,80}removeItem\(LEGACY_STORAGE_KEY\)/);
    assert.match(player, /resumeSessionForAccount\(expectedAccount, candidate, ownsGeneration, controller\.signal\)/);
    assert.match(player, /async function resumeSessionForAccount\([\s\S]{0,180}isCurrent: \(\) => boolean[\s\S]{0,180}requestForAccount\([\s\S]{0,100}isCurrent/);
    assert.doesNotMatch(player, /window\.api\.get\(`\/api\/exercises\/d1\/sessions\/\$\{encodeURIComponent\(candidate\)\}`\)/);
    assert.match(player, /clearResume\([\s\S]{0,100}expectedAccount,[\s\S]{0,100}candidate,[\s\S]{0,100}!disposed && accountRef\.current === expectedAccount/);
  });

  test('BL-17: the opening read is bounded and revokes its own ownership on timeout', () => {
    // Rendered proof: tests/react/vocabulary-read-timeout.test.tsx.
    assert.match(player, /export const D1_LOAD_TIMEOUT_MS = 15000;/);
    assert.match(player, /const ownsGeneration = \(\) => !disposed && !timedOut/);
    assert.match(player, /timedOut = true;\s*controller\.abort\(\);\s*setMessage\(D1_LOAD_TIMEOUT_MESSAGE\);\s*setPhase\('error'\);/);
    assert.match(player, /if \(!me \|\| typeof me !== 'object'\) throw/);
    assert.match(player, /return \(\) => \{ disposed = true; clearTimeout\(timer\); controller\.abort\(\); \};/);
  });

  test('account changes reset question state and retain a late start ACK for its owner', () => {
    assert.match(player, /setSession\(null\)[\s\S]{0,220}setIndex\(0\)[\s\S]{0,120}setChoice\(null\)[\s\S]{0,120}setAttemptKey\(''\)[\s\S]{0,120}setAttemptAck\(null\)[\s\S]{0,120}setSaveError\(''\)/);
    assert.match(player, /const ownsOperation = \(\) => accountRef\.current === expectedAccount[\s\S]{0,160}accountGenerationRef\.current === expectedGeneration[\s\S]{0,120}mutationOwnerRef\.current === operation/);
    assert.match(player, /const started = normalizeD1Start\(payload\)[\s\S]{0,420}retainSession\(expectedAccount, started\.sessionId\);[\s\S]{0,100}if \(!ownsOperation\(\)\) return/);
    assert.match(player, /function retainSession\(userId: string, sessionId: string\)[\s\S]{0,180}writeSessionIds\(userId/);
    assert.match(player, /async function requestForAccount[\s\S]{0,420}authSession\.user\?\.id !== expectedAccount[\s\S]{0,80}!isCurrent\(\)/);
    assert.match(player, /Authorization: `Bearer \$\{token\}`/);
    assert.match(player, /const payload = await startSessionForAccount\(expectedAccount, ownsOperation\)/);
    assert.doesNotMatch(player, /window\.api\.post\('\/api\/exercises\/d1\/sessions'/);
    assert.doesNotMatch(player, /if \(response\.status === 401\) window\.location\.href/);
    assert.doesNotMatch(player, /window\.api\.(?:get|post)\(/);
    assert.doesNotMatch(player, /caught\?\.status === 401[\s\S]{0,120}window\.location/);
    assert.match(player, /result\.response\.status === 401[\s\S]{0,420}isCurrent\(\)[\s\S]{0,120}refreshedSession\?\.user\?\.id === expectedAccount[\s\S]{0,220}refreshedSession\.access_token !== result\.token[\s\S]{0,120}dispatch\(refreshedSession\.access_token\)/);
    assert.match(player, /response\.status === 401 && isCurrent\(\)[\s\S]{0,320}latestSession\?\.user\?\.id === expectedAccount[\s\S]{0,120}latestSession\.access_token === result\.token[\s\S]{0,100}window\.location\.replace\('\/login'\)/);
    assert.match(player, /const requestId = [\s\S]{0,260}'X-Request-ID': requestId/);
    assert.match(player, /const generation = \+\+accountGenerationRef\.current[\s\S]*?mutationOwnerRef\.current = null\s*;?\s*mutationLock\.current = false/);
    assert.match(player, /finally \{\s*if \(mutationOwnerRef\.current === operation\) \{[\s\S]{0,100}mutationLock\.current = false/);
  });

  test('retries one stable client key and gates Next on canonical ACK', () => {
    assert.match(player, /client_attempt_id: key/);
    assert.match(player, /for \(let attempt = 0; attempt < 2 && !canonical/);
    assert.match(player, /for \(let attempt = 0; attempt < 2 && !canonical; attempt \+= 1\) \{\s*if \(!ownsOperation\(\)\) return;[\s\S]{0,180}requestForAccount\([\s\S]{0,180}ownsOperation/);
    assert.match(player, /normalizeD1AttemptAck\(payload, exercise, selected\)/);
    assert.match(player, /const canAdvance = answered && \(reviewMode \|\| !!attemptAck\) && !busy/);
    assert.match(player, /persistAnswer\(choice, attemptKey\)/);
  });

  test('uses canonical completion and keeps revision local-only', () => {
    assert.match(player, /normalizeD1Summary/);
    assert.match(player, /reviewMode\) return/);
    assert.match(player, /Đây là lượt ôn tập, không ghi nhận thêm lượt làm\./);
    assert.doesNotMatch(player, /dangerouslySetInnerHTML/);
  });

  test('keeps quota exhaustion recoverable without unlocking Next', () => {
    assert.match(player, /caught\?\.status === 429[\s\S]{0,80}break/);
    assert.match(player, /setAttemptRateLimited\(rateLimited\)/);
    assert.match(player, /attemptRateLimited \? <a className="btn-ghost" href="\/exercises">Rời phiên<\/a>/);
    // D1-UX: Content Manager approved 'Exercises' → 'Về trang bài luyện' for the back link.
    assert.match(player, /phase === 'rate_limited'[\s\S]{0,500}>Thử lại<[\s\S]{0,300}>Về trang bài luyện</);
    assert.match(player, /detail\?\.reset_at[\s\S]{0,180}toLocaleString\('vi-VN'\)/);
  });

  test('D1-FILL: start label and request size share one constant; thin sessions explain themselves', () => {
    assert.match(player, /const D1_SESSION_SIZE = 10;/);
    assert.match(player, /body: JSON\.stringify\(\{ size: D1_SESSION_SIZE \}\)/);
    assert.doesNotMatch(player, /size: 10\b/);
    assert.match(player, /const D1_START_KICKER = `Tự nhớ từ · tối đa \$\{D1_SESSION_SIZE\} câu`/);
    assert.match(player, /<span className="d1x-kicker">\{D1_START_KICKER\}<\/span>/);
    assert.doesNotMatch(player, /10 câu/);
    // Only a live (non-review) session smaller than the requested size shows the notice.
    assert.match(player, /const shortSession = !reviewMode && !!session && session\.exercises\.length < D1_SESSION_SIZE;/);
    assert.match(player, /<section className="d1x-player">\{shortSession \? <p className="d1x-alert" role="status">\{shortSessionNotice\(session\.exercises\.length\)\}<\/p> : null\}/);
  });

  test('D1-UX: learner-facing copy uses the four Content Manager approved terms', () => {
    for (const source of [page, player, hub]) {
      assert.doesNotMatch(source, /Fill the blank|Productive recall|PRODUCTIVE RECALL|đủ attempt|>Exercises<|Về Exercises|← Exercises/);
    }
    assert.match(page, /title: 'Điền từ — Aver Learning'/);
    assert.match(page, /← Bài luyện<\/a>/);
    assert.match(page, /<h1>Điền từ<\/h1>/);
    assert.equal((player.match(/>Về trang bài luyện<\/a>/g) || []).length, 3);
    assert.doesNotMatch(player, /Về Bài luyện/);
    assert.match(player, /Hệ thống đang đối chiếu đủ số lượt làm đã lưu\./);
    assert.match(hub, /<h1 class="subpage-header__title">Bài luyện<\/h1>/);
    assert.match(hub, /<a data-card="d1" href="\/d1-exercise"[\s\S]{0,240}<h3>Điền từ<\/h3>/);
  });

  test('D1-UX follow-up: Content Manager approved player and hub copy, no internal D1 code or English', () => {
    assert.match(player, /`Phiên này chỉ có \$\{count\} câu vì kho bài luyện hiện chưa có thêm câu phù hợp với bạn\.`/);
    assert.match(player, /'Máy chủ chưa xác nhận được lượt làm vừa lưu\.'/);
    assert.match(player, /'Không lưu được lượt làm\.'/);
    assert.match(player, /<p>Điền từ chưa được mở cho tài khoản của bạn\.<\/p>/);
    assert.match(player, /<p>Kho bài luyện hiện chưa có câu đã phát hành\.<\/p>/);
    assert.match(player, /reviewMode \? 'Ôn tập' : 'Phiên luyện tập'/);
    assert.doesNotMatch(player, /chừng đó|đúng attempt|lưu được attempt|ghi thêm attempt|D1 chưa được mở|Kho D1|'Phiên D1'/);
    for (const copy of [
      '<p class="text-sm">Đang tải…</p>',
      'Bài luyện chưa được bật',
      'Tính năng đang được mở dần. Bạn quay lại sau nhé.',
      'Không tải được trang bài luyện. Bạn hãy tải lại trang.',
      'Chọn dạng bài luyện',
      'Bài luyện từ vựng ngắn, bám sát vốn từ của bạn.',
      'Một câu ngắn bị thiếu một từ. Chọn từ phù hợp để điền vào.',
    ]) assert.ok(hub.includes(copy), `hub missing approved copy: ${copy}`);
    assert.equal((hub.match(/<span class="ex-pill pill-live">Đang mở<\/span>/g) || []).length, 2);
    assert.doesNotMatch(hub, /Loading…|not enabled|rolling out|exercise hub|Pick a drill|tied to your bank|one word missing|>Live</);
  });

  test('exercise hub sends new sessions to Next while retaining HTML rollback', () => {
    assert.match(hub, /href="\/d1-exercise"/);
    assert.doesNotMatch(hub, /href="\/pages\/d1-exercise\.html"/);
  });
});
