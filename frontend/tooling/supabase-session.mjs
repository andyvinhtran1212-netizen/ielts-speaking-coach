// Đăng nhập Supabase + dựng bản ghi phiên để TIÊM vào trình duyệt.
//
// VÌ SAO CÓ FILE NÀY: hai công cụ cùng cần đăng nhập bằng tài khoản probe —
// `authed-probe.mjs` (G2) gọi API bằng Bearer, và `parity-diff.mjs` (G1) cần
// một PHIÊN THẬT trong trình duyệt để so được trang cần đăng nhập. Hai bản
// đăng nhập riêng là hai chỗ để trôi khỏi nhau.
//
// VÌ SAO G1 CẦN CÁI NÀY: đo 2026-08-05 — `pages/home.html` có auth gate cuối
// trang (`window.location.href = '../login.html'`), nên trình duyệt ẩn danh
// KHÔNG BAO GIỜ dừng lại ở đó: sau khi JS chạy, URL là `/login.html`. G1 vì
// vậy cho `/home` con số không, không phải "chỉ so được vỏ". Mọi trang lưu
// lượng cao còn lại đều cần đăng nhập, nên đây là điều kiện cần để G1 còn
// dùng được cho phần còn lại của việc di trú.

/** Ref của project suy từ URL — dùng làm khoá localStorage của supabase-js. */
export function projectRef(supabaseUrl) {
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.co/i.exec(String(supabaseUrl || ''));
  if (!m) throw new Error(`không suy được project ref từ: ${supabaseUrl}`);
  return m[1];
}

/** Khoá localStorage mà supabase-js v2 dùng để lưu phiên. */
export function storageKey(supabaseUrl) {
  return `sb-${projectRef(supabaseUrl)}-auth-token`;
}

/**
 * Bản ghi phiên đúng hình dạng supabase-js v2 đọc được.
 *
 * `expires_at` là dấu thời gian TUYỆT ĐỐI (giây). Thiếu nó thì thư viện coi
 * phiên là hỏng và im lặng đăng xuất — trang lại rơi về `/login.html` và ta
 * quay lại đúng chỗ chưa sửa gì.
 */
export function sessionEntry(supabaseUrl, session, nowMs) {
  if (!session || !session.access_token) throw new Error('phiên không có access_token');
  const expiresIn = Number(session.expires_in) || 3600;
  return [
    storageKey(supabaseUrl),
    JSON.stringify({
      access_token: session.access_token,
      token_type: session.token_type || 'bearer',
      expires_in: expiresIn,
      expires_at: session.expires_at || Math.floor(nowMs / 1000) + expiresIn,
      refresh_token: session.refresh_token,
      user: session.user,
    }),
  ];
}

/** Đăng nhập bằng password grant. Ném lỗi rõ ràng thay vì trả về rỗng. */
export async function signIn({ supabaseUrl, anonKey, email, password, timeoutMs = 20000 }) {
  if (!email || !password) {
    throw new Error('thiếu PROBE_EMAIL/PROBE_PASSWORD — không thể đăng nhập');
  }
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`đăng nhập hỏng: HTTP ${res.status} ${body.error_code || body.msg || ''}`);
  }
  return body;
}
