/**
 * content-template-download.test.mjs — "Tải khuôn mẫu" download buttons.
 *
 * Each content-import UI (Reading content.html, Listening import-fulltest.html)
 * exposes <a download> links to the static templates under /templates/, next to
 * its upload mode(s). R/L templates must not cross. (Round-trip parsability is
 * guarded by backend test_content_templates_roundtrip.py.)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const READING = read('pages', 'admin', 'reading', 'content.html');
const LISTENING = read('pages', 'admin', 'listening', 'import-fulltest.html');


describe('Reading content.html — template downloads per upload mode', () => {
  test('single-file mode → L1/L2 template (download)', () => {
    assert.match(READING, /<a[^>]*\bdownload\b[^>]*href="\/templates\/reading\/l2-a2-detail-emperor-penguins\.md"/);
  });
  test('bundle mode → đề + giải templates (download)', () => {
    assert.match(READING, /<a[^>]*\bdownload\b[^>]*href="\/templates\/reading\/IELTS_Reading_Test_06\.md"/);
    assert.match(READING, /<a[^>]*\bdownload\b[^>]*href="\/templates\/reading\/IELTS_Reading_Test_06_Solution\.md"/);
  });
  test('no listening templates leak onto the reading page', () => {
    assert.doesNotMatch(READING, /\/templates\/listening\//);
  });
});


describe('Listening import-fulltest.html — pack template downloads', () => {
  test('QP + solution + timings templates (download)', () => {
    assert.match(LISTENING, /<a[^>]*\bdownload\b[^>]*href="\/templates\/listening\/ILR_LIS_001_Question_Paper\.md"/);
    assert.match(LISTENING, /<a[^>]*\bdownload\b[^>]*href="\/templates\/listening\/ILR_LIS_001_Solution\.md"/);
    assert.match(LISTENING, /<a[^>]*\bdownload\b[^>]*href="\/templates\/listening\/timings\.json"/);
  });
  test('audio is noted as the author\'s own (not templated)', () => {
    assert.match(LISTENING, /audio dùng file \.mp3 của bạn|\.mp3 của bạn/);
  });
  test('no reading templates leak onto the listening page', () => {
    assert.doesNotMatch(LISTENING, /\/templates\/reading\//);
  });
});
