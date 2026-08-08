// `/vocabulary` thuộc về WIKI CÔNG KHAI, không thuộc trang Từ vựng của học viên.
//
// VÌ SAO CẦN GHIM: hai trang KHÁC NHAU cùng quy về một tên khi bỏ đuôi `.html`
// theo hợp đồng URL của đợt di trú (`/pages/home.html` → `/home`):
//
//   public/vocabulary.html        (wiki, KHÔNG cần đăng nhập)  → /vocabulary
//   public/pages/vocabulary.html  (học viên, CẦN đăng nhập)    → /vocabulary
//
// Chủ dự án chốt ngày 2026-08-08: tên `/vocabulary` dành cho WIKI. Trang học
// viên ở lại `/vocabulary/hub` — đó là tên CUỐI CÙNG, không phải chỗ đậu tạm.
// Lý do và bằng chứng đo được: `docs/ROUTE_LEDGER.md` mục Q3.
//
// Không có chốt này thì quyết định chỉ sống trong một dòng ghi chú, và lần port
// wiki kế tiếp rất dễ thấy `/vocabulary` còn trống rồi lấy nó cho trang học
// viên — đúng kiểu quyết định bị đảo ngược trong im lặng.
//
// PHẠM VI CÓ Ý THỨC: chốt KHÔNG đòi wiki phải được port. Nó chỉ nói: NẾU có
// route `/vocabulary` thì route đó phải là trang công khai, và trang học viên
// phải ở `/vocabulary/hub`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'frontend/app');

/** Mọi `page.tsx`, kèm route (bỏ đoạn route-group) và tên nhóm chứa nó. */
function routes(dir = APP, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { routes(full, out); continue; }
    if (e.name !== 'page.tsx') continue;
    const seg = path.relative(APP, full).replace(/\/page\.tsx$/, '').split('/');
    const nhóm = seg.filter((x) => x.startsWith('(') && x.endsWith(')'));
    out.push({
      route: '/' + seg.filter((x) => !(x.startsWith('(') && x.endsWith(')'))).join('/'),
      nhóm,
      file: path.relative(ROOT, full),
    });
  }
  return out;
}

const R = routes();

describe('quyền sở hữu route /vocabulary (chốt 2026-08-08)', () => {
  test('quét được cây app/', () => {
    // Cây rỗng ⇒ mọi khẳng định dưới thành xanh-rỗng.
    assert.ok(R.length >= 10, `chỉ thấy ${R.length} route`);
  });

  test('trang Từ vựng của học viên ở `/vocabulary/hub`, không phải `/vocabulary`', () => {
    const hub = R.find((r) => r.route === '/vocabulary/hub');
    assert.ok(hub, 'không còn route /vocabulary/hub — trang học viên đã bị đổi tên?');
    // Nó là trang CẦN ĐĂNG NHẬP, nên phải nằm trong một nhóm `(authed-*)`.
    assert.ok(hub.nhóm.some((g) => g.startsWith('(authed')),
      `${hub.file} phải nằm trong nhóm (authed-*) — nó cần đăng nhập`);
  });

  test('nếu `/vocabulary` tồn tại thì nó phải là trang CÔNG KHAI', () => {
    const v = R.find((r) => r.route === '/vocabulary');
    if (!v) return;   // wiki chưa port — hợp lệ, không đòi
    assert.ok(!v.nhóm.some((g) => g.startsWith('(authed')),
      `${v.file} chiếm /vocabulary nhưng nằm trong nhóm cần đăng nhập. Tên đó dành `
      + 'cho wiki công khai (docs/ROUTE_LEDGER.md · Q3); trang học viên ở /vocabulary/hub.');
  });

  // CẢ TÀI LIỆU phải nhất quán, không riêng đoạn ghi quyết định.
  //
  // Bản đầu của chốt này chỉ khớp ĐÚNG MỘT CÂU ở mục Q3 — nên nó vẫn xanh trong
  // khi ba chỗ khác của cùng tài liệu vẫn ghi ngược lại: bảng route chính gán
  // `/vocabulary` cho trang HỌC VIÊN, hàng `/vocabulary/hub` ghi «chốt xong ai
  // sở hữu thì đổi», và Phụ lục B vẫn gọi tệp công khai là bí danh cũ. Một tài
  // liệu tự mâu thuẫn sẽ đẩy lần di trú sau đi đúng vào chỗ cần tránh — mà chốt
  // thì báo xanh (bot bắt ở #1009).
  test('không hàng bảng nào trong sổ còn nói ngược lại', () => {
    const sổ = readFileSync(path.join(ROOT, 'docs/ROUTE_LEDGER.md'), 'utf8');
    const hàng = sổ.split('\n').filter((l) => l.trimStart().startsWith('|'));

    // 1. Hàng có ô route ĐÚNG BẰNG `/vocabulary` phải trỏ tới tệp công khai.
    const cột = (l) => l.split('|').map((c) => c.trim());
    const xấu = [];
    for (const l of hàng) {
      const c = cột(l);
      if (c[1] !== '`/vocabulary`') continue;
      if (!/public\/vocabulary\.html/.test(l)) {
        xấu.push(`hàng /vocabulary không trỏ tới public/vocabulary.html: ${l.slice(0, 90)}`);
      }
      if (/\bStudent\b/.test(l)) {
        xấu.push(`hàng /vocabulary còn đánh dấu Student: ${l.slice(0, 90)}`);
      }
    }

    // 2. Không hàng nào nhắc vocabulary còn mang dấu vết «chưa quyết».
    const CŨ = [/cần rà soát/i, /needs audit/i, /likely legacy/i, /Chốt xong ai sở hữu/i,
                /awaiting|pending verification/i];
    for (const l of hàng) {
      if (!/vocabulary/i.test(l)) continue;
      for (const re of CŨ) {
        if (re.test(l)) xấu.push(`hàng còn dấu vết «chưa quyết» (${re}): ${l.slice(0, 90)}`);
      }
    }
    assert.deepEqual(xấu.sort(), [],
      'sổ route tự mâu thuẫn về chủ sở hữu `/vocabulary`');
  });

  test('quyết định được ghi ở nơi có thẩm quyền, không chỉ trong chốt này', () => {
    // Một chốt không kèm lý do sẽ bị gỡ bởi người không biết vì sao nó tồn tại.
    const sổ = readFileSync(path.join(ROOT, 'docs/ROUTE_LEDGER.md'), 'utf8');
    assert.match(sổ, /`\/vocabulary` thuộc về WIKI CÔNG KHAI/,
      'ROUTE_LEDGER phải ghi quyết định sở hữu route');
    assert.ok(existsSync(path.join(ROOT, 'frontend/public/vocabulary.html')),
      'wiki công khai biến mất — quyết định này cần xem lại');
    assert.ok(existsSync(path.join(ROOT, 'frontend/public/pages/vocabulary.html')),
      'trang học viên biến mất — quyết định này cần xem lại');
  });
});
