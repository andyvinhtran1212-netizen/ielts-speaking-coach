// MỌI id mà tầng hành vi với tay tới PHẢI tồn tại trong vỏ.
//
// VÌ SAO CẦN: đây là lớp lỗi IM LẶNG nguy hiểm nhất của khuôn "vá thẳng vào
// DOM". `document.getElementById('x')` trả `null` thì `if (el)` nuốt gọn — build
// xanh, test xanh, trang mở được, chỉ là nút không làm gì. Tôi đã dính đúng nó
// khi viết PR này: 6 nút và 2 container được gắn listener bằng id KHÔNG TỒN TẠI
// trong vỏ, vì bản legacy dùng handler nội tuyến nên những nút đó chưa từng cần
// id. Phải kiểm bằng máy, không kiểm bằng mắt.
//
// CHIỀU NGƯỢC LẠI cũng kiểm: id nào có trong bản legacy thì vỏ phải giữ — việc
// đó do `speaking-shell-fidelity.test.mjs` lo. Hai test bù nhau:
//   fidelity : legacy ⊆ vỏ   (không đánh mất thứ đã có)
//   hooks    : hành vi ⊆ vỏ  (không với tay vào thứ không có)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(FRONTEND, 'app/(authed-speaking)/speaking-preview');

const stripComments = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SHELL = stripComments(readFileSync(path.join(DIR, 'page-shell.tsx'), 'utf8'));
const BEHAVIOR = stripComments(readFileSync(path.join(DIR, 'speaking-behavior.tsx'), 'utf8'));

const shellIds = new Set([...SHELL.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

/**
 * Markup của bản legacy — mốc so sánh THẬT.
 *
 * Bản đầu của test này đòi mọi id phải có trong vỏ, và đỏ ở 4 chỗ mà chính bản
 * legacy CŨNG không có: ba container cờ tính năng (chưa từng render — xem
 * `applyVocabBankFlag`) và tiền tố `mtab-` (Sprint 8.1 đã gỡ hàng tab). Ở đó
 * hành vi legacy cũng no-op, nên bắt lỗi là bắt sai.
 *
 * Bất biến ĐÚNG: hành vi không được với tay vào thứ legacy CÓ mà vỏ ĐÁNH MẤT.
 * Vắng ở CẢ HAI thì hai bản hành xử giống nhau — đó là trung thực, không phải lỗi.
 */
const LEGACY_BODY = (() => {
  const src = readFileSync(path.join(FRONTEND, 'public/pages/speaking.html'), 'utf8');
  return /<body[^>]*>([\s\S]*?)<\/body>/.exec(src)[1]
    .replace(/<script[\s\S]*?<\/script>/g, '');
})();
const inLegacy = (id) => LEGACY_BODY.includes(`id="${id}"`);

/**
 * Miễn trừ TƯỜNG MINH — mỗi mục một lý do.
 *
 * Bản trước dùng quy tắc gộp "vắng ở legacy thì bỏ qua". Nghe hợp lý mà có LỖ:
 * nó tha luôn những id do CHÍNH tôi thêm vào vỏ làm móc (`pbp-start`,
 * `ft-start`…) — vốn cũng không có ở legacy. Đối chứng âm chứng minh: xoá
 * `id="pbp-start"` khỏi vỏ thì hành vi gãy im lặng mà test vẫn XANH.
 *
 * Nên chỉ miễn trừ đúng những chỗ hành vi legacy CŨNG no-op, và ghi rõ vì sao.
 */
const NO_OP_IN_BOTH = new Map([
  ['vocab-bank-link-container', 'Ví từ vựng cá nhân đã gỡ — legacy giữ hàm làm no-op, markup không có container'],
  ['exercises-link-container', 'Cờ Exercises chưa từng render container trên trang này'],
  ['flashcards-link-container', 'Cờ Flashcards chưa từng render container trên trang này'],
]);

/**
 * id do CHÍNH tầng hành vi tạo ra lúc chạy (nó tự chèn HTML), nên vỏ không có —
 * và đúng là không nên có.
 */
const CREATED_AT_RUNTIME = new Set(['flashcards-tab-sub']);

/** Tiền tố id được ghép động: `$('prefix' + biến)`. */
const DYNAMIC_PREFIXES = ['mtab-', 'tab-', 'prac-part-', 'prac-tp-part-', 'pbp-card-'];

describe('hành vi Speaking — mọi móc DOM đều có thật', () => {
  test('mọi id hằng trong $(\'…\') đều tồn tại ở vỏ', () => {
    const used = new Set([...BEHAVIOR.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
    assert.ok(used.size >= 15, `phải tìm thấy nhiều id, chỉ thấy ${used.size} — regex hỏng?`);
    const lost = [...used].filter((id) => !shellIds.has(id)
      && !CREATED_AT_RUNTIME.has(id) && !NO_OP_IN_BOTH.has(id));
    assert.deepEqual(lost, [],
      'hành vi với tay vào id không có trong vỏ ⇒ nút im lặng không làm gì, build vẫn xanh');
  });

  test('mọi miễn trừ đều còn đúng: legacy CŨNG không có', () => {
    // Miễn trừ chết là miễn trừ nói dối. Nếu legacy mọc lại container đó thì
    // bản Next phải có nó, và mục miễn trừ này phải bị gỡ.
    for (const [id, reason] of NO_OP_IN_BOTH) {
      assert.ok(!inLegacy(id), `legacy nay CÓ ${id} — gỡ miễn trừ và thêm vào vỏ`);
      assert.ok(reason.length > 25, `miễn trừ ${id} phải ghi lý do cụ thể`);
    }
  });

  test('mọi id GHÉP ĐỘNG đều có đủ biến thể 1/2/3 ở vỏ', () => {
    // `$('prac-part-' + p)` với p ∈ {1,2,3}. Thiếu một biến thể là mất đúng một
    // nút mà không có gì báo.
    for (const prefix of DYNAMIC_PREFIXES) {
      if (!BEHAVIOR.includes(`'${prefix}'`)) continue;   // tiền tố không dùng thì bỏ qua
      if (!LEGACY_BODY.includes(`id="${prefix}`)) continue;  // legacy cũng không có ⇒ no-op cả hai
      const found = [...shellIds].filter((id) => id.startsWith(prefix));
      assert.ok(found.length >= 3,
        `«${prefix}» chỉ thấy ${found.length} biến thể ở vỏ (${found.join(', ')})`);
    }
  });

  test('mọi selector hằng trong querySelectorAll đều khớp vỏ', () => {
    const sels = [...BEHAVIOR.matchAll(/querySelectorAll<[^>]*>\('([^']+)'\)/g)].map((m) => m[1]);
    for (const sel of sels) {
      for (const one of sel.split(',').map((x) => x.trim())) {
        const attr = /\[([\w-]+)="([^"]+)"\]/.exec(one);
        const cls = /^\.([\w-]+)/.exec(one);
        if (attr) {
          assert.ok(SHELL.includes(`${attr[1]}="${attr[2]}"`),
            `selector «${one}» không khớp phần tử nào trong vỏ`);
        } else if (cls) {
          assert.ok(SHELL.includes(cls[1]),
            `selector «${one}» không khớp class nào trong vỏ`);
        }
      }
    }
  });

  test('không port hàm mà bản legacy KHÔNG có đường gọi', () => {
    // `startPractice()` tồn tại trong JS legacy nhưng KHÔNG nút nào gọi (quét
    // toàn bộ markup: 0 handler). Bản đầu của tầng hành vi tự nghĩ ra một móc
    // `[data-start-part]` cho nó — tức dựng giao diện chưa từng tồn tại. Chốt
    // này giữ cho quyết định đó không bị lặng lẽ đảo ngược.
    const legacy = readFileSync(path.join(FRONTEND, 'public/pages/speaking.html'), 'utf8');
    const body = /<body[^>]*>([\s\S]*?)<\/body>/.exec(legacy)[1]
      .replace(/<script[\s\S]*?<\/script>/g, '');
    assert.ok(!/startPractice\s*\(/.test(body),
      'nếu legacy ĐÃ có nút gọi startPractice thì phải port nó — cập nhật test này');
    assert.ok(!BEHAVIOR.includes('data-start-part'),
      'đừng dựng móc cho một hàm không có đường gọi');
  });

  test('mọi listener đều có đường gỡ (StrictMode chạy effect hai lần)', () => {
    // Gắn trực tiếp bằng addEventListener mà không qua helper `on()` là chỗ rò:
    // effect chạy lại sẽ chồng listener, và một cú bấm gửi hai request tạo phiên.
    const direct = [...BEHAVIOR.matchAll(/(\w+)\.addEventListener\(/g)].map((m) => m[1]);
    const outsideHelper = direct.filter((recv) => recv !== 'el');
    assert.deepEqual(outsideHelper, [],
      'dùng helper on() để mỗi listener đều được đẩy vào cleanups');
  });
});
