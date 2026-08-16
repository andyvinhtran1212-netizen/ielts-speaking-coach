/** Regression gate for the native authenticated `/quiz` player. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-quiz-player)', 'quiz', 'page.tsx');
const BEHAVIOR = read('app', '(authed-quiz-player)', 'quiz', 'quiz-player.tsx');
const LAYOUT = read('app', '(authed-quiz-player)', 'layout.tsx');
const CSS = read('public', 'css', 'quiz-player.css');
const OUTBOX = read('lib', 'quiz-progress-outbox.mjs');
const MODEL = read('lib', 'quiz-player-model.mjs');

describe('/quiz — native React owner', () => {
  test('does not embed or inject the rollback document', () => {
    assert.doesNotMatch(PAGE, /quiz\.html|dangerouslySetInnerHTML|<script/);
    assert.doesNotMatch(BEHAVIOR, /quiz\.html|dangerouslySetInnerHTML|\.innerHTML\s*=/);
    assert.match(LAYOUT, /AuthedShell/);
    assert.match(LAYOUT, /\/css\/quiz-player\.css/);
  });

  test('keys all state to auth account + query and aborts stale bank reads', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /requestKey = status === 'signed-in'/);
    assert.match(BEHAVIOR, /ownerKey === requestKey/);
    assert.match(BEHAVIOR, /requestKeyRef\.current !== expectedKey/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login'\)/);
  });

  test('preserves canonical bank, resume, session, progress, reset and finalization contracts', () => {
    assert.match(BEHAVIOR, /\/api\/quiz\/banks\$\{suffix\}/);
    assert.match(BEHAVIOR, /\/api\/quiz\/banks\/\$\{encodeURIComponent\(resolution\.bankId\)\}/);
    assert.match(BEHAVIOR, /\/resume/);
    assert.match(BEHAVIOR, /window\.api\.post\('\/api\/quiz\/sessions'/);
    assert.match(BEHAVIOR, /QuizProgressOutbox/);
    assert.match(BEHAVIOR, /window\.api\.patch\(`\/api\/quiz\/sessions/);
    assert.match(BEHAVIOR, /\/reset/);
    assert.match(BEHAVIOR, /confirmed = Array\.isArray\(resume\) && resume\.length === 0/);
  });

  test('locks duplicate answer, advance, session-start, reset and finish actions synchronously', () => {
    for (const lock of ['answerLockRef', 'advanceLockRef', 'startLockRef', 'resetLockRef', 'finishLockRef']) {
      assert.match(BEHAVIOR, new RegExp(`${lock}\\.current`));
    }
    assert.match(BEHAVIOR, /if \(advanceLockRef\.current \|\| requestKeyRef\.current !== expectedKey\) return/);
    assert.match(BEHAVIOR, /if \(resetLockRef\.current \|\| !currentBank \|\| !requestKey\) return/);
    assert.match(BEHAVIOR, /enterSubmitRef\.current = true; submitAnswer\(textAnswer\)/);
    assert.match(BEHAVIOR, /document\.addEventListener\('keyup', onKeyUp\)/);
  });

  test('never persists review-mode attempts and keeps failed progress for retry/keepalive', () => {
    assert.match(OUTBOX, /if \(this\.#review\) return/);
    assert.match(OUTBOX, /catch \{\s*return false/);
    assert.match(OUTBOX, /while \(force && saved/);
    assert.match(BEHAVIOR, /keepalive: true/);
    assert.match(MODEL, /ended_by: saved === true \? 'completed' : 'paused'/);
    assert.match(BEHAVIOR, /Chưa xác nhận lưu hết tiến độ/);
  });

  test('keeps answer explanations, session review and accessible modal/focus behavior', () => {
    assert.match(BEHAVIOR, /Đáp án đúng:/);
    assert.match(BEHAVIOR, /Xem lại bài làm/);
    assert.match(BEHAVIOR, /role="dialog"/);
    assert.match(BEHAVIOR, /aria-modal="true"/);
    assert.match(BEHAVIOR, /event\.key !== 'Tab'/);
    assert.match(BEHAVIOR, /summaryHeadingRef\.current\?\.focus/);
    assert.match(BEHAVIOR, /promptRef\.current\?\.focus/);
    assert.match(CSS, /\.qz-finishing/);
    assert.match(CSS, /prefers-reduced-motion/);
  });
});

describe('/quiz — canonical inbound navigation', () => {
  test('all active Next entry points use the native owner while rollback remains present', () => {
    const sources = [
      read('app', '(authed-vocab-practice)', 'vocabulary', 'practice', 'vocab-practice-behavior.tsx'),
      read('app', '(public-content)', 'grammar', 'exercises', 'grammar-exercises-behavior.tsx'),
      read('app', '(public-content)', 'grammar', '[category]', '[slug]', 'article-behavior.tsx'),
      read('app', '(authed-vocabulary-hub)', 'vocabulary', 'hub', 'vocabulary-hub-behavior.tsx'),
    ];
    for (const source of sources) {
      assert.match(source, /\/quiz\?/);
      assert.doesNotMatch(source, /\/pages\/quiz\.html/);
    }
    assert.match(read('public', 'pages', 'quiz.html'), /Quick-Check/);
  });
});
