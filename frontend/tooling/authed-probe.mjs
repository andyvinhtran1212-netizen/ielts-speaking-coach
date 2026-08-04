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

import { appendFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { evaluateG2, formatG2, planSession, parseLedger, mergeLedgers } from './g2-floor.mjs';
import { signIn as sharedSignIn } from './supabase-session.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };

const MODE = arg('--mode', 'tick');
// MỖI CHẾ ĐỘ MỘT SỔ. `tick` và `session` chạy song song (concurrency group đã
// tách), nên dùng chung một tệp trong cache là mất mẫu: bên lưu sau đè bên
// trước. Verdict gộp tất cả sổ lại.
const LEDGER_DIR = arg('--ledger-dir', 'out');
const LEDGER = arg('--ledger', null) || path.join(LEDGER_DIR, `g2-ledger-${MODE}.jsonl`);
const API_BASE = (arg('--api', 'https://ielts-speaking-coach-production.up.railway.app')).replace(/\/+$/, '');
const SUPABASE_URL = arg('--supabase', 'https://huwsmtubwulikhlmcirx.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON = process.env.PROBE_SUPABASE_ANON || 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
// Đường dẫn THẬT: router auth gắn prefix `/auth` (backend/routers/auth.py:17),
// KHÔNG có tiền tố `/api`. Đo trên production: `/api/auth/me` → 404 còn
// `/auth/me` → 401 (có route, cần đăng nhập).
//
// **KHÔNG dùng `/auth/me`.** Nó là GET nhưng GHI THẬT (auth.py:188–214):
// INSERT hàng `users` nếu chưa có, và UPDATE `users.last_seen_at` MỖI LẦN GỌI.
// Bật cron 20 phút với nó nghĩa là 72 lần ghi/ngày vào bảng người dùng, làm
// bẩn đúng dữ liệu hoạt động mà admin đọc. Tôi đã đánh đồng "phương thức GET"
// với "không tác dụng phụ" — review PR #910 vòng 2 bắt được.
//
// `/auth/profile` và `/auth/check-active` chỉ `.select(...)`, đọc thuần.
// LƯU Ý THIẾT LẬP: `/auth/profile` trả 404 nếu tài khoản chưa có hàng `users`,
// nên chủ dự án phải **đăng nhập một lần qua giao diện** để hàng đó được tạo.
// Lần ghi duy nhất vì thế nằm ở bước thiết lập của con người, không nằm trong
// vòng chạy của probe.
// Mục có tiền tố `site:` gọi vào TRANG (Vercel), không phải backend (Railway).
//
// Review #926 chỉ đúng một chỗ overclaim: probe chỉ gọi `/auth/*` trên Railway,
// nên nếu route `/profile` trên Vercel hỏng (deploy lỗi, cache ôi, cold start)
// mà backend vẫn khoẻ thì verdict VẪN xanh — tức nó không xả được đúng rủi ro
// mà ngoại lệ /profile nêu ra.
//
// GIỚI HẠN của mục `site:`: `/profile` xác thực phía CLIENT (phiên Supabase
// trong trình duyệt), nên một GET kèm Bearer chỉ lấy được vỏ SSR. Nó phủ được
// "route còn deploy, còn render, không 5xx" — KHÔNG phủ được luồng đăng nhập
// và refresh phía client. Muốn phủ vế đó phải chạy trình duyệt thật giữ phiên
// qua một giờ; đắt hơn nhiều, chưa làm. Ghi rõ trong ADR-013-A2.
const SITE_BASE = (arg('--site', 'https://www.averlearning.com')).replace(/\/+$/, '');
const ROUTES = (arg('--routes', '/auth/profile,/auth/check-active,site:/profile') || '')
  .split(',').filter(Boolean);
const TIMEOUT_MS = Number(arg('--timeout', '15000')) || 15000;

const EMAIL = process.env.PROBE_EMAIL || '';
const PASSWORD = process.env.PROBE_PASSWORD || '';

/** Đăng nhập — dùng CHUNG module với cổng parity để không có hai bản trôi nhau. */
function signIn() {
  return sharedSignIn({
    supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON,
    email: EMAIL, password: PASSWORD, timeoutMs: TIMEOUT_MS,
  });
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
  const isSite = route.startsWith('site:');
  const path = isSite ? route.slice(5) : route;
  const base = isSite ? SITE_BASE : API_BASE;
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!isSite) {
      return {
        route, ok: res.ok, status: res.status, ms: Date.now() - started,
        note: res.ok ? undefined : (await res.text()).slice(0, 160),
      };
    }
    // Với trang: 200 CHƯA đủ — Next trả 200 cho cả vỏ hỏng. Đòi thêm dấu hiệu
    // đã render thật (payload RSC + chrome dùng chung), đúng bài học "200 không
    // chứng minh trang chạy" đã gặp nhiều lần trong đợt này.
    const html = await res.text();
    const rendered = html.includes('__next_f') && html.includes('aver-chrome');
    return {
      route, ok: res.ok && rendered, status: res.status, ms: Date.now() - started,
      note: res.ok && !rendered ? 'HTTP 200 nhưng thiếu dấu hiệu render (__next_f / aver-chrome)' : undefined,
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

/** Đọc MỌI sổ trong thư mục (hoặc đúng một tệp nếu `--ledger` được chỉ định). */
function readLedger() {
  const explicit = arg('--ledger', null);
  if (explicit) {
    return existsSync(explicit)
      ? parseLedger(readFileSync(explicit, 'utf8'))
      : { samples: [], corruptLines: 0 };
  }
  if (!existsSync(LEDGER_DIR)) return { samples: [], corruptLines: 0 };
  const files = readdirSync(LEDGER_DIR)
    .filter((f) => /^g2-ledger-.*\.jsonl$/.test(f)).sort();
  return mergeLedgers(files.map((f) => parseLedger(readFileSync(path.join(LEDGER_DIR, f), 'utf8'))));
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
  const stepMin = Number(arg('--step-minutes', '15')) || 15;
  const maxMin = Number(arg('--max-minutes', '80')) || 80;

  const sess0 = await signIn();
  const t0 = Date.now();
  // Lấy hạn từ chính phiên, không đoán: Supabase trả `expires_in` (giây).
  const expiresInMs = (Number(sess0.expires_in) || 3600) * 1000;
  const plan = planSession({
    expiresInMs, stepMs: stepMin * 60_000, maxMs: maxMin * 60_000,
  });
  if (!plan.coversRefresh) {
    console.error(
      `session: trần ${maxMin} phút không đủ đi qua hạn token `
      + `(${(expiresInMs / 60000).toFixed(0)} phút). Tăng --max-minutes; `
      + 'KHÔNG refresh sớm rồi ghi afterRefresh — đó là ghi khống bằng chứng.');
    process.exit(2);
  }
  console.log(
    `session: token sống ${(expiresInMs / 60000).toFixed(0)} phút · `
    + `${plan.preOffsets.length} nhịp trước hạn · refresh ở phút `
    + `${(plan.refreshAt / 60000).toFixed(0)}`);

  let allOk = true;
  const sleepUntil = async (offset) => {
    const wait = t0 + offset - Date.now();
    if (wait > 0) await new Promise((s) => setTimeout(s, wait));
  };

  // Vế TRƯỚC mốc refresh — mọi nhịp đều an toàn trước hạn.
  for (const off of plan.preOffsets) {
    await sleepUntil(off);
    for (const r of ROUTES) {
      const res = await probeOnce(sess0.access_token, r);
      record({ at: Date.now(), mode: 'session', afterRefresh: false, ...res });
      allOk = allOk && res.ok;
    }
    console.log(`  … phút ${(off / 60000).toFixed(0)} bằng token gốc`);
  }

  // Ngủ tới SAU hạn rồi mới refresh — có vậy mới thật sự đi qua mốc.
  await sleepUntil(plan.refreshAt);
  const sess1 = await refresh(sess0.refresh_token);
  console.log('session: đã refresh token sau khi token cũ hết hạn');

  for (const r of ROUTES) {
    const res = await probeOnce(sess1.access_token, r);
    record({
      at: Date.now(), mode: 'session', afterRefresh: true,
      tokenAgeMs: Date.now() - t0, ...res,
    });
    allOk = allOk && res.ok;
    console.log(`  sau refresh: ${r} = ${res.status}`);
  }
  process.exit(allOk ? 0 : 1);
}

function modeVerdict() {
  const authenticated = argv.includes('--anonymous') ? false : true;
  const { samples, corruptLines } = readLedger();
  const result = evaluateG2(samples, { authenticated, corruptLines });
  console.log(formatG2(result));
  process.exit(result.pass ? 0 : 1);
}

const run = { tick: modeTick, session: modeSession, verdict: async () => modeVerdict() }[MODE];
if (!run) { console.error(`--mode không hợp lệ: ${MODE}`); process.exit(2); }
run().catch((e) => { console.error('G2 probe lỗi —', e.message || e); process.exit(1); });
