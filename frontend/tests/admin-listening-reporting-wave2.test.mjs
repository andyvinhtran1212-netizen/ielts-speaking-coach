/**
 * admin-listening-reporting-wave2.test.mjs — audit 2026-07-17 đợt 2:
 * (a) dashboard admin đổi nguồn khỏi bảng chết + render % + đếm chép chính tả;
 * (b) dictation-reports có cột HỌC VIÊN + filter + drill-down chi tiết phiên;
 * (c) analytics học viên rewire sang listening_test_attempts.
 * Source sentinels.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const OVJS = read('js', 'admin-overview.js');
const OVHTML = read('pages', 'admin', 'index.html');
const DRHTML = read('pages', 'admin', 'listening', 'dictation-reports.html');
const DRJS = read('js', 'admin-listening-dictation-reports.js');
const ANJS = read('js', 'listening-analytics.js');

describe('dashboard admin — tile Listening', () => {
  test('render % đúng (avg 0..1 từ nguồn mới), không còn .toFixed(2) điểm thô', () => {
    assert.match(OVJS, /Math\.round\(skills\.listening\.avg_score_7d \* 100\) \+ '%'/);
    assert.doesNotMatch(OVJS, /avg_score_7d\.toFixed\(2\)/);
  });
  test('đếm phiên chép chính tả 7d', () => {
    assert.match(OVJS, /data-skill-dict="listening"/);
    assert.match(OVHTML, /Chép ch\.tả 7d/);
    assert.match(OVHTML, /data-skill-dict="listening"/);
  });
  test('label tile là "Đúng TB" (accuracy), không phải điểm thô', () => {
    assert.match(OVHTML, /<span class="stat-label">Đúng TB<\/span>/);
  });
});

describe('dictation-reports — cột học viên + filter + drill-down', () => {
  test('bảng có cột Học viên; row render tên + email', () => {
    assert.match(DRHTML, /<th>Học viên<\/th>/);
    assert.match(DRJS, /u\.display_name \|\| '—'/);
    assert.match(DRJS, /u\.email \|\| u\.id/);
  });
  test('filter học viên gửi user_query', () => {
    assert.match(DRHTML, /id="dr-user"/);
    assert.match(DRJS, /user_query=' \+ encodeURIComponent\(userQ\)/);
  });
  test('bấm row gọi endpoint detail (từng câu: điểm, học viên gõ, nghe, lỗi)', () => {
    assert.match(DRHTML, /id="dr-detail"/);
    assert.match(DRJS, /\/admin\/listening\/dictation-reports\/' \+ encodeURIComponent\(id\)/);
    assert.match(DRJS, /<th>Học viên gõ<\/th>/);
    assert.match(DRJS, /sót ' \+ ops\.miss/);
  });
});

describe('listening-analytics (học viên) — nguồn mới', () => {
  test('nhãn theo test_type, hết hệ exercise chết', () => {
    assert.match(ANJS, /mini:\s+'Bài học \/ Mini test'/);
    assert.doesNotMatch(ANJS, /'Chép chính tả'/);
  });
  test('recent hiện tiêu đề bài + trạng thái bỏ dở/đang làm thay vì 0%', () => {
    assert.match(ANJS, /r\.status === 'abandoned' \? 'bỏ dở' : 'đang làm'/);
    assert.match(ANJS, /r\.title \|\| MODE_LABELS\[r\.type\]/);
  });
  test('cột completion thay accuracy cũ', () => {
    assert.match(ANJS, /r\.completion == null \? '—'/);
  });
});
