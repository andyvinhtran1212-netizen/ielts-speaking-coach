/**
 * admin-listening-attempts.test.mjs — trang admin "Lượt làm bài nghe"
 * (audit 2026-07-17: 418 attempts trong listening_test_attempts vô hình với
 * admin). Source sentinels — page/JS là DOM/IIFE, không import được.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const PAGE = read('pages', 'admin', 'listening', 'attempts.html');
const JS = read('js', 'admin-listening-attempts.js');
const CHROME = read('js', 'components', 'aver-admin-chrome.js');

describe('attempts.html — cấu trúc trang', () => {
  test('đăng ký đúng chrome admin + subsection', () => {
    assert.match(PAGE, /<aver-admin-chrome active="listening" subsection="attempts">/);
    assert.match(PAGE, /admin-listening-attempts\.js/);
  });
  test('đủ bộ lọc: học viên, bài, loại, trạng thái', () => {
    for (const id of ['la-user', 'la-test', 'la-type', 'la-status', 'la-apply']) {
      assert.match(PAGE, new RegExp(`id="${id}"`), `thiếu #${id}`);
    }
    assert.match(PAGE, /value="abandoned"/);       // trạng thái Bỏ dở lọc được
  });
  test('bảng có đủ cột trả lời 4 câu hỏi audit (ai/bài/bao lâu/tỉ lệ đúng)', () => {
    assert.match(PAGE, /<th>Học viên<\/th>/);
    assert.match(PAGE, /<th>Bài<\/th>/);
    assert.match(PAGE, /<th>Điểm<\/th>/);
    assert.match(PAGE, /<th>Thời lượng<\/th>/);
    // KHÔNG có cột "Đã nghe": audio_duration_listened_seconds chưa từng được
    // ghi (luôn 0) — hiện nó là misleading (review P1).
    assert.doesNotMatch(PAGE, /Đã nghe/);
  });
  test('có khối chi tiết + pager', () => {
    assert.match(PAGE, /id="la-detail"/);
    assert.match(PAGE, /id="la-pager"/);
  });
});

describe('admin-listening-attempts.js — hành vi', () => {
  test('gọi đúng endpoints admin', () => {
    assert.match(JS, /\/admin\/listening\/attempts' \+ qs\(\)/);
    assert.match(JS, /\/admin\/listening\/attempts\/' \+ encodeURIComponent\(id\)/);
  });
  test('render danh tính học viên + bài, KHÔNG hiện user_id trần khi có email', () => {
    assert.match(JS, /u\.display_name \|\| '—'/);
    assert.match(JS, /u\.email \|\| u\.id/);
    assert.match(JS, /t\.title \|\| '—'/);
  });
  test('drill-down: bảng từng câu (học viên trả lời / đáp án / trap)', () => {
    assert.match(JS, /Học viên trả lời/);
    assert.match(JS, /grading_details \|\| \[\]/);
    assert.match(JS, /trap_caught \? ' 🪤✓' : \(d\.trap_missed \? ' 🪤✗' : ''\)/);
    assert.match(JS, /\(bỏ trống\)/);
  });
  test('trạng thái có nhãn tiếng Việt, gồm Bỏ dở', () => {
    assert.match(JS, /submitted: 'Đã nộp', in_progress: 'Đang làm', abandoned: 'Bỏ dở'/);
  });
  test('deep-link ?user= để trang khác filter sẵn học viên', () => {
    assert.match(JS, /new URLSearchParams\(location\.search\)\.get\('user'\)/);
  });
  test('phân trang qua offset (tôn trọng PostgREST cap)', () => {
    assert.match(JS, /offset = Math\.max\(0, offset - LIMIT\)/);
    assert.match(JS, /offset \+= LIMIT/);
  });
  test('escape mọi chuỗi động (đi qua esc/WC.escapeHtml)', () => {
    assert.match(JS, /window\.WC && window\.WC\.escapeHtml/);
  });
});

describe('nav admin', () => {
  test('Lượt làm bài nằm trong subsections của Listening', () => {
    assert.match(CHROME, /slug: 'attempts',\s+label: 'Lượt làm bài',\s+href: '\/pages\/admin\/listening\/attempts\.html'/);
  });
});
