// G2 của ADR-013-A1 — probe synthetic CÓ ĐĂNG NHẬP, CHỈ ĐỌC.
//
// Vì sao tồn tại: cửa sổ quan sát `/profile` (02–03/08) nhận đúng **2 request
// trong 25,1h**, cả hai của tôi. 0 organic, và 0 synthetic vì
// `playwright.production-smoke.config.js` không có `storageState` nên chạy ẩn
// danh và bị đẩy sang `/login.html`. Lỗi thời-gian-trôi — token refresh, cache
// hết hạn, cold start, cron — **không hiện ra nếu không ai gọi**. Cửa sổ trôi
// qua trong im lặng. G2 là thứ phát request trong khoảng thời gian đó.
//
// TẦNG HTTP, KHÔNG DỰNG TRÌNH DUYỆT — có chủ ý:
//   · Chế độ hỏng mà G2 nhắm tới lộ ra ở tầng HTTP (401 sau refresh, 5xx do
//     cold start, nội dung ôi do cache hết hạn). Không cần render.
//   · Đúng-đắn nội dung là việc của G1 (cổng parity), không phải G2. Hai cổng,
//     hai vế, không chồng lấn.
//   · Không chạy JS của trang ⇒ không có `POST /api/analytics/events`. Bộ so
//     parity từng suýt bơm hàng trăm `page_view` giả vào chính bảng dùng để ra
//     quyết định; probe chạy 72 lần/ngày mà mắc lại lỗi đó thì còn tệ hơn.
//
// CHỈ ĐỌC là ràng buộc cứng: chỉ phát GET. Không có nhánh nào ghi.
//
// Chạy:
//   node tooling/authed-probe.mjs --mode tick      # một nhịp, dùng cho cron 20'
//   node tooling/authed-probe.mjs --mode session   # ~70' để đi qua token refresh
//   node tooling/authed-probe.mjs --mode verdict   # chấm sổ theo sàn ADR-013-A1

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { evaluateG2, formatG2 } from './g2-floor.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };

const MODE = arg('--mode', 'tick');
const LEDGER = arg('--ledger', 'out/g2-ledger.jsonl');
const API_BASE = (arg('--api', 'https://ielts-speaking-coach-production.up.railway.app')).replace(/\/+$/, '');
const SUPABASE_URL = arg('--supabase', 'https://huwsmtubwulikhlmcirx.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON = process.env.PROBE_SUPABASE_ANON || 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
const ROUTES = (arg('--routes', '/api/auth/me,/api/profile') || '').split(',').filter(Boolean);
const TIMEOUT_MS = Number(arg('--timeout', '15000')) || 15000;

const EMAIL = process.env.PROBE_EMAIL || '';
const PASSWORD = process.env.PROBE_PASSWORD || '';

/** Đăng nhập bằng password grant; trả về cả refresh_token để mode session dùng. */
async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`đăng nhập hỏng: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

/** Đổi refresh token lấy access token mới — đúng chế độ hỏng cần phủ. */
async function refresh(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`refresh hỏng: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

/** CHỈ GET. Không có tham số nào đổi được phương thức. */
async function probeOnce(token, route) {
  const started = Date.now();
  try {
    const res = await fetch(`${API_BASE}${route}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      route, ok: res.ok, status: res.status, ms: Date.now() - started,
      note: res.ok ? undefined : (await res.text()).slice(0, 160),
    };
  } catch (e) {
    return { route, ok: false, status: 0, ms: Date.now() - started, note: String(e).slice(0, 160) };
  }
}

function record(sample) {
  const dir = path.dirname(LEDGER);
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
  appendFileSync(LEDGER, `${JSON.stringify(sample)}\n`);
}

function readLedger() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function requireCreds() {
  if (!EMAIL || !PASSWORD) {
    // Thoát 78 (EX_CONFIG) chứ KHÔNG phải 0: thiếu cấu hình không được đọc
    // thành "đã chạy xong". Verdict cũng từ chối sổ rỗng, nên không có đường
    // nào biến việc chưa bật thành bằng chứng đã phủ.
    console.error(
      'G2 chưa bật: thiếu PROBE_EMAIL/PROBE_PASSWORD.\n'
      + 'Cần một TÀI KHOẢN PROBE RIÊNG trên production (chủ dự án tự tạo — tôi '
      + 'không tạo tài khoản), rồi thêm hai secret cùng tên vào repo.');
    process.exit(78);
  }
}

async function modeTick() {
  requireCreds();
  const sess = await signIn();
  const results = [];
  for (const r of ROUTES) results.push(await probeOnce(sess.access_token, r));
  const sample = {
    at: Date.now(), mode: 'tick',
    ok: results.every((r) => r.ok),
    status: results.find((r) => !r.ok)?.status ?? 200,
    route: ROUTES.join(','),
    note: results.filter((r) => !r.ok).map((r) => `${r.route}:${r.note}`).join(' | ') || undefined,
    results,
  };
  record(sample);
  console.log(`tick: ${sample.ok ? 'OK' : 'HỎNG'} — ${results.map((r) => `${r.route}=${r.status}`).join(' ')}`);
  process.exit(sample.ok ? 0 : 1);
}

/**
 * Một phiên sống dài đi QUA mốc token refresh, có request ở cả hai phía.
 * Access token của Supabase mặc định sống 1 giờ, nên mặc định chờ 65 phút.
 */
async function modeSession() {
  requireCreds();
  const holdMin = Number(arg('--hold-minutes', '65')) || 65;
  const stepMin = Number(arg('--step-minutes', '15')) || 15;

  let sess = await signIn();
  const t0 = Date.now();
  console.log(`session: đăng nhập lúc ${new Date(t0).toISOString()}, giữ ${holdMin} phút`);

  // Vế TRƯỚC mốc refresh.
  for (let waited = 0; waited < holdMin; waited += stepMin) {
    for (const r of ROUTES) {
      const res = await probeOnce(sess.access_token, r);
      record({ at: Date.now(), mode: 'session', afterRefresh: false, ...res });
    }
    console.log(`  … đã giữ ${waited + stepMin}/${holdMin} phút`);
    await new Promise((s) => setTimeout(s, stepMin * 60_000));
  }

  // Chính mốc cần phủ: đổi refresh token, rồi gọi lại bằng token MỚI.
  sess = await refresh(sess.refresh_token);
  console.log('session: đã refresh token');
  let allOk = true;
  for (const r of ROUTES) {
    const res = await probeOnce(sess.access_token, r);
    record({ at: Date.now(), mode: 'session', afterRefresh: true, tokenAgeMs: Date.now() - t0, ...res });
    allOk = allOk && res.ok;
    console.log(`  sau refresh: ${r} = ${res.status}`);
  }
  process.exit(allOk ? 0 : 1);
}

function modeVerdict() {
  const authenticated = argv.includes('--anonymous') ? false : true;
  const result = evaluateG2(readLedger(), { authenticated });
  console.log(formatG2(result));
  process.exit(result.pass ? 0 : 1);
}

const run = { tick: modeTick, session: modeSession, verdict: async () => modeVerdict() }[MODE];
if (!run) { console.error(`--mode không hợp lệ: ${MODE}`); process.exit(2); }
run().catch((e) => { console.error('G2 probe lỗi —', e.message || e); process.exit(1); });
