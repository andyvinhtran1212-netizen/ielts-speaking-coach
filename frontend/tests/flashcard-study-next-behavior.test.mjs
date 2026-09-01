import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const page = read('app', '(flashcard-study)', 'flashcard-study', 'page.tsx');
const player = read('app', '(flashcard-study)', 'flashcard-study', 'flashcard-study-player.tsx');
const layout = read('app', '(flashcard-study)', 'layout.tsx');
const legacy = read('public', 'pages', 'flashcard-study.html');

describe('/flashcard-study native ownership', () => {
  test('owns the canonical route while keeping the rollback artifact isolated', () => {
    assert.match(page, /<FlashcardStudyPlayer/);
    assert.match(page, /<aver-chrome active="vocabulary"/);
    assert.match(layout, /flashcard-study-next\.css/);
    assert.match(layout, /authGated=\{false\}/);
    assert.doesNotMatch(page + player + layout, /flashcard-study\.js/);
    assert.match(legacy, /flashcard-study\.js/);
  });

  test('keeps wiki and exam modes public while personal stacks are account-keyed', () => {
    assert.match(player, /stack\.mode !== 'personal'/);
    assert.match(player, /\/api\/vocabulary\/categories\//);
    assert.match(player, /\/api\/vocabulary\/exam\//);
    assert.match(player, /const accountKey = status === 'signed-in'/);
    assert.match(player, /accountRef\.current === expectedAccount/);
    assert.match(player, /window\.location\.replace\(`\/login\?next=/);
  });

  test('gates personal advance on a canonical, idempotent persistence receipt', () => {
    assert.match(player, /client_review_id: operation\.clientId/);
    assert.match(player, /'X-Request-ID': operation\.clientId/);
    assert.match(player, /normalizeReviewReceipt\(payload, expectedCardId\)/);
    assert.match(player, /setBreakdown[\s\S]{0,180}advance\(\)/);
    assert.match(player, /setSaveError\(`Chưa lưu được đánh giá:/);
    assert.match(player, /submitRating\(pendingRating\.rating, pendingRating\)/);
    assert.doesNotMatch(player, /failedSyncs|fire-and-forget|tiến độ local đã ghi/);
  });

  test('preserves public local marks, audio fallback, keyboard and rich content', () => {
    assert.match(player, /localStorage\.setItem/);
    assert.match(player, /window\.speechSynthesis\.speak/);
    assert.match(player, /event\.key === ' '/);
    assert.match(player, /card\.collocations/);
    assert.match(player, /card\.memoryHook/);
    assert.match(player, /card\.commonError/);
    assert.doesNotMatch(player, /dangerouslySetInnerHTML|\.innerHTML\s*=/);
  });

  test('uses the shared modal primitive with keyboard focus containment', () => {
    assert.match(player, /className="av-modal-backdrop"/);
    assert.match(player, /className="av-modal" role="dialog"/);
    assert.match(player, /event\.key !== 'Tab'/);
    assert.match(player, /sourceTriggerRef\.current\?\.focus\(\)/);
    assert.match(player, /event\.key === 'Escape'/);
    assert.doesNotMatch(player, /fcs-dialog/);
  });
});
