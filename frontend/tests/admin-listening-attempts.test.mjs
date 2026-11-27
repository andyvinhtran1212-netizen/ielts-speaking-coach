/**
 * admin-listening-attempts.test.mjs — trang admin "Lượt làm bài nghe"
 * (audit 2026-07-17: 418 attempts trong listening_test_attempts vô hình với
 * admin). Source sentinels — page/JS là DOM/IIFE, không import được.
 *
 * LEGACYJS-0075 W1: public/js/admin-listening-attempts.js đã gỡ; phần hành vi
 * nay do admin-listening-attempts-next-behavior.test.mjs +
 * verify-admin-listening-attempts-flow.mjs giữ (TEST_INVARIANT_LEDGER).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const PAGE = read('pages', 'admin', 'listening', 'attempts.html');
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

describe('nav admin', () => {
  test('Lượt làm bài nằm trong subsections của Listening', () => {
    assert.match(CHROME, /slug: 'attempts',\s+label: 'Lượt làm bài',\s+href: '\/admin\/listening\/attempts'/);
  });
});


describe('type filter covers every test_type the table allows', () => {
  // listening_tests.test_type accepts full | mini | drill | practice
  // (CHECK, migration 173). A value missing from the dropdown is a whole
  // bank of attempts an admin cannot filter to; a value missing from
  // TYPE_LABEL renders as the raw slug in the "Loại" column.
  const KINDS = ['full', 'mini', 'drill', 'practice'];

  test('every kind is offered in the #la-type dropdown', () => {
    for (const k of KINDS) {
      assert.match(
        PAGE, new RegExp(`<option value="${k}">`),
        `#la-type is missing <option value="${k}"> — admins cannot filter that bank`,
      );
    }
  });

});
