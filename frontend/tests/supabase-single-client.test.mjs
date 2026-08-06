// `initSupabase()` chỉ được dựng ĐÚNG MỘT GoTrue client cho mỗi trang.
//
// VÌ SAO: hai client dùng chung một khoá lưu trữ sẽ tranh nhau làm mới token và
// tranh nhau sự kiện đăng nhập giữa các tab; client bị bỏ rơi vẫn sống và vẫn
// ghi vào cùng chỗ. Triệu chứng ngoài đời là "thỉnh thoảng bị đăng xuất" —
// loại lỗi không tái hiện được theo yêu cầu, nên phải chặn bằng chốt.
//
// Trang legacy gọi đúng một lần nên không bao giờ lộ. Lỗi lộ ra khi đưa các
// module `public/js/*` sang route Next: module tự gọi `initSupabase` ở đầu tệp,
// còn `AuthedShell` cũng gọi ở `DOMContentLoaded` (Codex bắt ở PR #951). Vì
// chiến lược của cả nhóm 21 trang chỉ-đọc là NẠP LẠI chính module cũ, đây là
// hợp đồng của cả nhóm chứ không riêng một trang.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_JS = readFileSync(path.join(ROOT, 'frontend/public/js/api.js'), 'utf8');

/** Chạy api.js trong sandbox với một `supabase.createClient` đếm được. */
function loadApi() {
  let created = 0;
  const win = {
    supabase: {
      createClient: (url, key) => { created += 1; return { __id: created, url, key }; },
    },
    location: { hostname: 'localhost', origin: 'http://localhost:3000', href: 'http://localhost:3000/' },
    addEventListener() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  };
  win.window = win;
  const ctx = vm.createContext(win);
  ctx.document = { addEventListener() {}, readyState: 'complete' };
  ctx.console = console;
  vm.runInContext(API_JS, ctx);
  return { win, count: () => created };
}

describe('api.js — một GoTrue client cho mỗi trang', () => {
  test('api.js nạp được và có phơi ra initSupabase', () => {
    // Nếu sandbox không chạy được api.js thì mọi khẳng định dưới thành xanh-rỗng.
    const { win } = loadApi();
    assert.equal(typeof win.initSupabase, 'function', 'không thấy initSupabase');
    assert.equal(typeof win.getSupabase, 'function', 'không thấy getSupabase');
  });

  test('gọi hai lần chỉ dựng MỘT client', () => {
    const { win, count } = loadApi();
    const a = win.initSupabase('https://x.supabase.co', 'anon-key');
    assert.equal(count(), 1, 'lần gọi đầu phải dựng client');
    const b = win.initSupabase('https://x.supabase.co', 'anon-key');
    assert.equal(count(), 1, 'lần gọi thứ hai KHÔNG được dựng thêm client');
    assert.equal(a, b, 'phải trả về cùng một client');
    assert.equal(win.getSupabase(), a);
  });

  test('lần gọi đầu NÉM thì lần sau vẫn dựng được', () => {
    // Ca thật: `initSupabase()` không đối số chạy trước khi runtime-config có
    // giá trị. Nếu chốt idempotent làm hỏng đường phục hồi này thì trang sẽ
    // vĩnh viễn không có client — tệ hơn hẳn lỗi ban đầu.
    const { win, count } = loadApi();
    win.supabase.createClient = (url, key) => {
      if (!url) throw new Error('supabaseUrl is required');
      return { url, key };
    };
    assert.throws(() => win.initSupabase(undefined, undefined));
    const ok = win.initSupabase('https://y.supabase.co', 'anon-key');
    assert.ok(ok && ok.url === 'https://y.supabase.co', 'lần sau phải dựng được');
  });
});
