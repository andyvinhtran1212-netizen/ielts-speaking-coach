// Phần thuần của cụm thống kê Speaking — so TRỰC TIẾP với nguồn legacy.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODE_BADGE, escHtml, historyHasActiveFilters, roundHalf } from '../lib/speaking-stats.mjs';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = readFileSync(path.join(FRONTEND, 'public/pages/speaking.html'), 'utf8');
const FORMAT = readFileSync(path.join(FRONTEND, 'public/js/format.js'), 'utf8');

describe('thống kê Speaking — phần thuần khớp legacy', () => {
  test('roundHalf trùng công thức của format.js', () => {
    // Không import được (`format.js` là script cổ điển gán vào window), nên
    // ghim bằng cách so công thức trong mã nguồn + kiểm vài ca.
    assert.match(FORMAT, /Math\.round\(val \* 2\) \/ 2/);
    assert.equal(roundHalf(6.2), 6);
    assert.equal(roundHalf(6.25), 6.5);
    assert.equal(roundHalf(6.75), 7);
    assert.equal(roundHalf(6.5).toFixed(1), '6.5');
  });

  test('escHtml giữ nguyên hành vi legacy — KHÔNG escape nháy đơn', () => {
    // Bản legacy cố ý chỉ escape 4 ký tự. Thêm `'` vào là đổi chữ hiển thị
    // (`&#39;` lọt ra màn hình ở chỗ legacy in dấu nháy) ⇒ parity gãy.
    assert.equal(escHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
    assert.equal(escHtml("d'ont"), "d'ont");
    assert.equal(escHtml(null), '');
    assert.match(LEGACY, /replace\(\/&\/g,'&amp;'\)/);
  });

  test('nhãn + màu badge trùng legacy', () => {
    for (const [mode, b] of Object.entries(MODE_BADGE)) {
      assert.ok(LEGACY.includes(`'${b.label}'`), `nhãn «${b.label}» không còn trong legacy`);
      assert.ok(LEGACY.includes(b.bg), `màu nền của ${mode} không còn trong legacy`);
      assert.ok(LEGACY.includes(b.fg), `màu chữ của ${mode} không còn trong legacy`);
    }
    assert.deepEqual(Object.keys(MODE_BADGE), ['practice', 'test_part', 'test_full']);
  });

  test('bảng rỗng vì LỌC khác bảng rỗng vì CHƯA CÓ GÌ', () => {
    // Quyết định này chi phối việc có hiện khối "bạn chưa luyện buổi nào" hay
    // không. Nhầm là nói dối người dùng vừa gõ một từ khoá không khớp.
    const base = { search: '', sort: 'newest', date_from: '', date_to: '' };
    assert.equal(historyHasActiveFilters(base), false);
    assert.equal(historyHasActiveFilters({ ...base, search: 'abc' }), true);
    assert.equal(historyHasActiveFilters({ ...base, date_from: '2026-01-01' }), true);
    assert.equal(historyHasActiveFilters({ ...base, date_to: '2026-01-01' }), true);
    assert.equal(historyHasActiveFilters({ ...base, sort: 'oldest' }), true);
    assert.equal(historyHasActiveFilters({ ...base, sort: 'newest' }), false,
      'sort mặc định KHÔNG tính là bộ lọc đang bật');
    assert.equal(historyHasActiveFilters(null), false);
  });

  test('cache SWR chỉ dùng cho DỮ LIỆU HIỂN THỊ, không cho quyền', () => {
    // Quy tắc canonical-truth: một người vừa bị thu quyền không được gác bằng
    // trạng thái cũ trên máy họ.
    const src = readFileSync(
      path.join(FRONTEND, 'app/(authed-speaking)/speaking-preview/speaking-stats.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(src.includes("writeDashCache"), 'phải có đường ghi cache');
    assert.ok(!/auth\/me/.test(src), 'KHÔNG được đụng /auth/me trong cụm thống kê');
    assert.ok(!/permissions/.test(src), 'KHÔNG được cache quyền');
  });
});
