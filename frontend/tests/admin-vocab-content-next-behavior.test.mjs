import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'content', 'admin-vocab-content.tsx');
const PAGE = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'content', 'page.tsx');
const HUB = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'page.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');

describe('Admin Vocabulary Content native ownership', () => {
  test('owns the clean route while retaining the rollback artifact', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'vocab', 'content.html')));
    assert.match(HUB, /href: '\/admin\/vocab\/content'/);
    assert.match(CHROME, /slug: 'content'[^\n]*href: '\/admin\/vocab\/content'/);
  });

  test('admits category deep links through canonical topics and uses server pagination', () => {
    assert.match(CLIENT, /normalizeTopicList/);
    assert.match(CLIENT, /rows\.some\(\(row\) => row\.slug === requestedCategory\)/);
    assert.match(CLIENT, /limit: String\(PAGE_SIZE\), offset: String\(targetOffset\)/);
    assert.match(CLIENT, /normalizeVocabList/);
    assert.doesNotMatch(CLIENT, /\bconfirm\(|\balert\(/);
  });

  test('dry-runs every file and performs one combined, one-shot commit', () => {
    assert.match(CLIENT, /\/admin\/vocabulary\/import\?dry_run=true/);
    assert.ok(CLIENT.includes("new File([texts.join('\\n\\n')], 'combined.md'"));
    assert.match(CLIENT, /\/admin\/vocabulary\/import\?dry_run=false/);
    assert.match(CLIENT, /normalizeVocabImport/);
    assert.match(CLIENT, /Không tự động retry write này/);
  });

  test('requires strict write ACKs and canonical readback', () => {
    assert.match(CLIENT, /normalizeVocabDetail\(await window\.api\.patch/);
    assert.ok((CLIENT.match(/normalizeVocabDetail\(await window\.api\.get/g) || []).length >= 2);
    assert.match(CLIENT, /normalizeDeleteAck/);
    assert.match(CLIENT, /normalizeBulkDeleteAck/);
    assert.match(CLIENT, /normalizeAudioAck/);
    assert.match(CLIENT, /mutationLock\.current/);
    assert.match(CLIENT, /page\.words\.length === 0 && page\.total <= nextOffset/);
    assert.match(CLIENT, /setEditWord\(null\); setDraft\(null\); setEditError\(''\); setConfirmState\(null\)/);
  });

  test('preserves rich word-family JSON instead of comma-coercing objects', () => {
    assert.match(CLIENT, /wordFamilyJson: JSON\.stringify/);
    assert.match(CLIENT, /parseJsonList\(draft\.wordFamilyJson\)/);
    assert.match(CLIENT, /word_family: wordFamily/);
  });

  test('keeps audio preview fallback and counted destructive dialogs', () => {
    assert.match(CLIENT, /new Audio\(url\)/);
    assert.match(CLIENT, /SpeechSynthesisUtterance/);
    assert.match(CLIENT, /kind: 'bulk'; words: Word\[\]/);
    assert.match(CLIENT, /Xoá \$\{confirmState\.words\.length\} từ đã chọn/);
    assert.match(CLIENT, /Chi phí bên thứ ba/);
    assert.match(CLIENT, /<details className="avv-content-import" open=\{importOpen\} onToggle=/);
  });
});
