/**
 * admin-student-listening.test.mjs — audit 2026-07-17 đợt 3: mục Listening
 * trong hồ sơ học viên (drawer) + tín hiệu bỏ dở + deep-link sang 2 trang
 * báo cáo listening. Source sentinels.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const PAGE = read('pages', 'admin', 'students', 'index.html');
const DRJS = read('js', 'admin-listening-dictation-reports.js');

describe('hồ sơ học viên — mục Tiến độ (listening)', () => {
  test('drawer có 4 stat: lượt làm, đúng TB, bỏ dở, chép chính tả', () => {
    assert.match(PAGE, /Tiến độ \(listening\)/);
    for (const id of ['stat-listen-total', 'stat-listen-acc', 'stat-listen-abandoned', 'stat-listen-dict']) {
      assert.match(PAGE, new RegExp(`id="${id}"`), `thiếu #${id}`);
    }
    // Bỏ dở dùng style cảnh báo (tín hiệu vấn đề)
    assert.match(PAGE, /id="stat-listen-abandoned" class="adm-card-num st-flagged"/);
  });
  test('render từ detail.listening + reset khi mở drawer', () => {
    assert.match(PAGE, /detail && detail\.listening/);
    assert.match(PAGE, /lis\.avg_accuracy \* 100/);
    assert.match(PAGE, /stat-listen-total'\)\.textContent = '—'/);
  });
  test('deep-link sang 2 trang báo cáo, filter sẵn học viên theo email', () => {
    assert.match(PAGE, /\/pages\/admin\/listening\/attempts\.html' \+ linkQs/);
    assert.match(PAGE, /\/pages\/admin\/listening\/dictation-reports\.html' \+ linkQs/);
    assert.match(PAGE, /'\?user=' \+ encodeURIComponent\(userQ\)/);
  });
  test('chưa kích hoạt tài khoản → nói rõ, không im lặng', () => {
    assert.match(PAGE, /Chưa kích hoạt tài khoản — chưa có dữ liệu listening\./);
    assert.match(PAGE, /Không tải được dữ liệu listening\./);
  });
});

describe('dictation-reports nhận deep-link ?user=', () => {
  test('prefill bộ lọc học viên từ query param', () => {
    assert.match(DRJS, /new URLSearchParams\(location\.search\)\.get\('user'\)/);
  });
});
