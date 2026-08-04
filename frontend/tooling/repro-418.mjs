// Repro CỤC BỘ cho hydration mismatch trên /home-preview — để khỏi phải chờ CI.
// KHÔNG dùng tài khoản thật: nhét một phiên GIẢ vào localStorage chỉ để chặn
// guard client-side chuyển hướng đi, đủ lâu cho React hydrate. Token vô giá trị,
// mọi lệnh gọi API sẽ 401 — không sao, ta chỉ đo hydration.
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';

const ARGV = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SLOW = process.argv.includes('--slow-react');
const BASE = ARGV[0] || 'http://localhost:3000';
const PATHS = ARGV.slice(1);
if (!PATHS.length) PATHS.push('/home-preview');

const fake = JSON.stringify({
  access_token: 'repro-not-a-real-token',
  refresh_token: 'repro',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000000', email: 'repro@local' },
});

const browser = await chromium.launch();
let bad = 0;
for (const p of PATHS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (_) {} },
    [storageKey(SB), fake]);
  const page = await ctx.newPage();
  // Đua tiến trình: lucide (defer, CDN) vs chunk hydrate của React. Một lần
  // chạy xanh KHÔNG chứng minh không có lỗi. --slow-react ép kịch bản xấu
  // nhất — lucide luôn chạy trước hydrate — để repro tất định.
  // Đối chứng âm: chặn lucide. Nếu #418 biến mất thì lucide ĐÚNG là nguyên nhân.
  if (process.argv.includes('--no-lucide')) {
    await page.route('**/unpkg.com/lucide**', (r) => r.abort());
  }
  if (SLOW) {
    await page.route('**/_next/static/**', async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });
  }
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + p, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3000);
  const hyd = errs.filter((e) => /#418|#423|#425|Hydration/i.test(e));
  console.log(`\n${p} → ${page.url()}`);
  console.log(`  lỗi console: ${errs.length} · trong đó hydration: ${hyd.length}`);
  for (const e of hyd.slice(0, 3)) console.log('   ✗ ' + e.slice(0, 150));
  if (hyd.length) bad++;
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
