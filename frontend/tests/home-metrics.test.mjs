// Bản Next của trang chủ phải cho ĐÚNG cùng kết quả với bản legacy.
//
// VÌ SAO KHÔNG CHỈ TEST BẢN MỚI: hai bản render cùng một trang cho cùng một
// người dùng, và cổng parity G1 so CHỮ trên màn hình. Một khác biệt trong
// formatter — '6.5' vs '6.50', 'Hôm qua' vs '1 ngày trước' — là parity gãy.
// Nên bộ ca dưới đây chạy QUA CẢ HAI: `lib/home-metrics.mjs` (Next) và
// `public/js/home.js` (legacy, nạp qua `window.__home`).
//
// Đây là "test ĐƯỜNG, đừng test HÀM": ghim riêng bản mới thì hai bản vẫn trôi
// khỏi nhau mà test vẫn xanh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import * as next from '../lib/home-metrics.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Nạp IIFE legacy trong sandbox và lấy ra mặt test `window.__home`. */
function loadLegacy() {
  const win = {};
  const ctx = vm.createContext({
    window: win,
    document: {
      // IIFE chỉ gắn listener lúc nạp; các hàm thuần không chạm DOM.
      readyState: 'complete',
      addEventListener() {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    setTimeout() {},
    console,
  });
  vm.runInContext(readFileSync(join(ROOT, 'public/js/home.js'), 'utf8'), ctx);
  assert.ok(win.__home, 'legacy home.js phải phơi window.__home');
  return win.__home;
}

const legacy = loadLegacy();

// `vm` tạo realm riêng nên object legacy có prototype KHÁC — `deepStrictEqual`
// sẽ đỏ dù nội dung trùng hệt. Chuẩn hoá về plain object trước khi so.
const plain = (o) => JSON.parse(JSON.stringify(o));

// ── Hai bản, cùng bộ ca ────────────────────────────────────────────────────
const IMPLS = [
  ['Next  (lib/home-metrics.mjs)', next],
  ['legacy (public/js/home.js)', legacy],
];

for (const [label, impl] of IMPLS) {
  test(`${label} — formatRelativeTime`, () => {
    const f = impl.formatRelativeTime;
    assert.equal(f(null), 'Chưa có hoạt động');
    assert.equal(f(''), 'Chưa có hoạt động');
    assert.equal(f('not-a-date'), 'Chưa có hoạt động');

    const day = 86400_000;
    const ago = (ms) => new Date(Date.now() - ms).toISOString();
    assert.equal(f(ago(0)), 'Hôm nay');
    // +2h để không rơi qua mốc ngày khi test chạy sát nửa đêm.
    assert.equal(f(ago(day + 2 * 3600_000)), 'Hôm qua');
    assert.equal(f(ago(3 * day + 2 * 3600_000)), '3 ngày trước');
    assert.equal(f(ago(14 * day + 2 * 3600_000)), '2 tuần trước');
    assert.equal(f(ago(60 * day + 2 * 3600_000)), '2 tháng trước');
    assert.equal(f(ago(400 * day)), '1 năm trước');
    // Mốc ở TƯƠNG LAI (lệch giờ máy khách) → 'Hôm nay', không phải số âm.
    assert.equal(f(new Date(Date.now() + day).toISOString()), 'Hôm nay');
  });

  test(`${label} — METRIC_FORMATTERS`, () => {
    const M = impl.METRIC_FORMATTERS;

    const w = M.writing({ last_band: 6.5, essays_count: 3, essays_in_progress: 1 });
    assert.equal(w.primary.value, '6.5');
    assert.equal(w.primary.unit, 'band');
    assert.match(w.sub, /3 bài đã nộp/);
    assert.match(w.sub, /1 đang chờ/);
    assert.deepEqual(plain(M.writing({})), { primary: { value: '—', unit: 'band' }, sub: 'Chưa có bài nào' });

    const s = M.speaking({ last_band: 6.0, sessions_count: 12 });
    assert.equal(s.primary.value, '6.0');
    assert.match(s.sub, /12 session/);
    assert.equal(M.speaking({}).sub, 'Chưa luyện session nào');

    assert.deepEqual(plain(M.grammar({ lessons_viewed: 7 })),
      { primary: { value: '7', unit: 'bài đã xem' }, sub: 'Xem lại các bài đã đánh dấu' });
    assert.equal(M.grammar({}).sub, 'Khám phá 67 bài học ngữ pháp');

    // Ví + Quick-Check: dòng phụ phải gọi ĐÚNG nguồn con số (PR #876).
    assert.match(M.vocabulary({ words_learned: 42, flashcards_due: 5 }).sub, /5 thẻ đến hạn/);
    assert.equal(M.vocabulary({ words_learned: 10, wallet_words: 10 }).sub, 'Wallet từ vựng cá nhân');
    assert.equal(M.vocabulary({ words_learned: 136, quiz_words_mastered: 136 }).sub, 'Đã thuộc qua Quick-Check');
    assert.equal(M.vocabulary({ words_learned: 5, wallet_words: 2, quiz_words_mastered: 3 }).sub,
      'Wallet cá nhân + Quick-Check');
    assert.equal(M.vocabulary({}).sub, 'Bắt đầu lưu từ mới');

    assert.equal(M.reading({ last_band: 7 }).primary.value, '7.0');
    assert.equal(M.reading({}).sub, 'Luyện đọc với bài kiểm tra IELTS thực tế');

    // Listening đổi CẢ đơn vị khi chưa có band — dễ trôi nhất giữa hai bản.
    assert.deepEqual(plain(M.listening({})),
      { primary: { value: '0', unit: 'bài' }, sub: 'Luyện nghe với dictation và comprehension' });
    assert.deepEqual(plain(M.listening({ attempts_count: 4 })),
      { primary: { value: '4', unit: 'bài' }, sub: 'Tiếp tục luyện nghe' });
    assert.equal(M.listening({ last_band: 5.5, attempts_count: 4 }).primary.unit, 'band');
  });
}

// ── Chốt chặn thật: hai bản phải TRÙNG trên cùng đầu vào ────────────────────
test('hai bản cho kết quả TRÙNG KHỚP trên mọi ca', () => {
  const CASES = {
    writing: [{}, { last_band: 6.5, essays_count: 3, essays_in_progress: 1 }, { essays_count: 2 }],
    speaking: [{}, { last_band: 7.5, sessions_count: 1 }],
    grammar: [{}, { lessons_viewed: 0 }, { lessons_viewed: 99 }],
    vocabulary: [{}, { words_learned: 42, flashcards_due: 5 },
      { words_learned: 3, wallet_words: 3 }, { words_learned: 9, quiz_words_mastered: 9 },
      { words_learned: 9, wallet_words: 4, quiz_words_mastered: 5 }],
    reading: [{}, { last_band: 6, attempts_count: 2 }],
    listening: [{}, { attempts_count: 4 }, { last_band: 5.5, attempts_count: 4 }],
  };
  for (const [skill, cases] of Object.entries(CASES)) {
    for (const c of cases) {
      assert.deepEqual(
        plain(next.METRIC_FORMATTERS[skill](c)),
        plain(legacy.METRIC_FORMATTERS[skill](c)),
        `${skill} lệch nhau với đầu vào ${JSON.stringify(c)}`,
      );
    }
  }
});

test('thứ tự kỹ năng và metadata trùng nhau', () => {
  // Legacy không phơi SKILLS_ORDER/SKILL_META ra `window.__home`, nên đọc thẳng
  // mã nguồn: thứ tự thẻ trên trang là thứ tự người dùng NHÌN THẤY, lệch là
  // parity gãy dù từng thẻ đều đúng.
  const src = readFileSync(join(ROOT, 'public/js/home.js'), 'utf8');
  const order = /const SKILLS_ORDER = \[([^\]]+)\]/.exec(src)[1]
    .split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual([...next.SKILLS_ORDER], order);

  for (const id of order) {
    const re = new RegExp(`${id}:\\s*\\{[^}]*?name:\\s*'([^']+)'`, 's');
    const m = re.exec(src);
    assert.ok(m, `không đọc được name của ${id} trong home.js`);
    assert.equal(next.SKILL_META[id].name, m[1], `${id}: tên kỹ năng lệch`);
  }
});
