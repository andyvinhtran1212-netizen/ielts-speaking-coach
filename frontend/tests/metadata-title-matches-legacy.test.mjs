// `metadata.title` của mỗi route Next phải TRÙNG `<title>` của trang legacy nó thay.
//
// VÌ SAO: nhãn tab, mục lịch sử và tên bookmark đều lấy từ đây. Lệch thì người
// dùng cutover xong thấy tab đổi tên — thay đổi nhìn thấy được mà không ai chủ ý.
//
// Cổng parity CÓ phát hiện chuyện này, nhưng ở mức CẢNH BÁO (`! [title-mismatch]`),
// nên nó trôi qua nhiều PR: `/home` và `/speaking` mang lệch "Aver Learning" vs
// "AverLearning" (thiếu dấu cách) từ đợt pilot, và tôi đã đọc đúng dòng cảnh báo
// đó trong log rồi bỏ qua vì tưởng là nhiễu có sẵn. Bot bắt lại ở #960 qua một
// trang khác, và quét cơ học thì ra BA chỗ chứ không phải một.
//
// Chốt này biến cảnh báo thành lỗi ĐỎ, và quét MỌI cặp thay vì cặp đang sửa.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'frontend/app');
const pairs = JSON.parse(
  readFileSync(path.join(ROOT, 'frontend/tooling/parity-pairs-authed.json'), 'utf8'));

/** Mọi `page.tsx` dưới `app/`, kèm URL route (bỏ các đoạn route-group). */
function routeIndex(dir = APP, out = new Map()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { routeIndex(full, out); continue; }
    if (e.name !== 'page.tsx') continue;
    const segs = path.relative(APP, full)
      .replace(/\/page\.tsx$/, '')
      .split('/')
      .filter((s) => s && !(s.startsWith('(') && s.endsWith(')')));
    out.set('/' + segs.join('/'), full);
  }
  return out;
}

const ROUTES = routeIndex();

describe('metadata.title khớp <title> của bản legacy', () => {
  test('đọc được cặp parity và cây route', () => {
    // Một trong hai rỗng ⇒ khẳng định dưới thành xanh-rỗng.
    assert.ok(pairs.length >= 10, `chỉ thấy ${pairs.length} cặp parity`);
    assert.ok(ROUTES.size >= 10, `chỉ thấy ${ROUTES.size} route`);
  });

  test('không cặp nào lệch title', () => {
    const bad = [];
    for (const p of pairs) {
      const file = ROUTES.get(p.next);
      if (!file) { bad.push(`${p.next}: không tìm thấy page.tsx`); continue; }

      const m = /title:\s*'([^']+)'/.exec(readFileSync(file, 'utf8'));
      if (!m) { bad.push(`${p.next}: page.tsx không khai metadata.title`); continue; }

      const html = readFileSync(path.join(ROOT, 'frontend/public' + p.legacy), 'utf8');
      const t = /<title>([^<]*)<\/title>/.exec(html);
      if (!t) { bad.push(`${p.legacy}: không có <title>`); continue; }

      if (t[1].trim() !== m[1].trim()) {
        bad.push(`${p.next}: next=${JSON.stringify(m[1])} vs legacy=${JSON.stringify(t[1])}`);
      }
    }
    assert.deepEqual(bad.sort(), [],
      'nhãn tab/lịch sử/bookmark sẽ đổi sau cutover — parity chỉ CẢNH BÁO chuyện này '
      + 'nên nó trôi qua nhiều PR; ở đây nó là lỗi đỏ');
  });
});
