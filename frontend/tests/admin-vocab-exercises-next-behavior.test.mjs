import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'exercises', 'admin-vocab-exercises.tsx');
const PAGE = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'exercises', 'page.tsx');
const HUB = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'page.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');

describe('Admin Vocabulary Exercises native ownership', () => {
  test('owns the clean route and retains rollback HTML', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'vocab', 'exercises.html')));
    assert.match(HUB, /href: '\/admin\/vocab\/exercises'/);
    assert.match(CHROME, /slug: 'exercises'[^\n]*href: '\/admin\/vocab\/exercises'/);
  });

  test('reads all three status queues with strict scoped models', () => {
    assert.match(CLIENT, /Promise\.all\(EXERCISE_STATUSES\.map/);
    assert.match(CLIENT, /normalizeExerciseList/);
    assert.match(CLIENT, /exercise_type=D1&limit=\$\{LIMIT\}/);
    assert.match(CLIENT, /Mỗi queue hiển thị tối đa \{LIMIT\}/);
  });

  test('requires exact single/bulk ACKs and canonical three-queue readback', () => {
    assert.match(CLIENT, /normalizeExerciseAck/);
    assert.match(CLIENT, /normalizeBulkAck/);
    assert.match(CLIENT, /const canonical = await fetchSnapshot\(\)/);
    assert.match(CLIENT, /Không xác định status write đã tới backend hay chưa/);
    assert.doesNotMatch(CLIENT, /\bconfirm\(|\balert\(/);
  });

  test('treats Gemini generation as synchronous, partial and paid', () => {
    assert.match(CLIENT, /normalizeGenerationAck/);
    assert.match(CLIENT, /có thể mất gần 120 giây/);
    assert.match(CLIENT, /ack\.status === 'partial'/);
    assert.match(CLIENT, /Đây là write có chi phí/);
    assert.match(CLIENT, /count > parsedWords\.length/);
    assert.match(CLIENT, /disabled=\{busy \|\| loading\} onClick=\{openGenerate\}/);
  });

  test('resets account-owned state and supports accessible tabs/dialogs', () => {
    assert.match(CLIENT, /setSnapshot\(EMPTY_SNAPSHOT\)/);
    assert.match(CLIENT, /role="tablist"/);
    assert.match(CLIENT, /aria-selected=\{status === item\}/);
    assert.match(CLIENT, /ArrowLeft/);
    assert.match(CLIENT, /aria-modal="true"/);
  });
});
