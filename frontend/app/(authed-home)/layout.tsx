// Layout RIÊNG cho trang chủ học viên — KHÔNG dùng chung với `(authed)`.
//
// VÌ SAO TÁCH: `home.css` có LUẬT TOÀN CỤC (`* { box-sizing }`, `html, body`,
// `a`) ở dòng 19/21/30, còn `profile.css` thì KHÔNG có luật toàn cục nào. Nạp
// home.css vào layout dùng chung sẽ đổ ba luật đó lên `/profile` — một trang
// ĐANG CHẠY, 0 lỗi. Rủi ro làm hỏng trang sống lớn hơn nợ trùng lặp layout.
//
// NỢ ĐÃ BIẾT: layout này gần như trùng `(authed)/layout.tsx`. Cách gộp đúng là
// đưa stylesheet-của-trang ra khỏi layout (React 19 hoist `<link precedence>`),
// nhưng làm vậy là đổi thứ tự cascade của một trang đang sống — để sau, làm có
// chủ đích. Hai layout khác nhau ĐÚNG MỘT DÒNG: profile.css ↔ home.css.
//
// Phần dưới giữ nguyên văn từ `(authed)/layout.tsx`. Head assets byte-faithful
// với pages/home.html: same fonts (Plus Jakarta Sans + JetBrains Mono), same
// stylesheet cascade (tokens → components → ds → profile.css → tailwind LAST,
// P0-3 C-3.4), same deferred script order (supabase CDN → runtime-config →
// api.js → initSupabase on DOMContentLoaded).
//
// Auth is CLIENT-ONLY (ADR-003 §3): this layout is a Server Component but
// reads no cookies/headers — it renders the static shell and mounts
// AuthProvider, which consumes the window Supabase client that api.js creates.
import { ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth/auth-provider';

// Canonical anti-flash theme bootstrap (DESIGN_SYSTEM § 13) — must run before
// any stylesheet so [data-theme] is set on <html> before paint.
const ANTI_FLASH = `
(function () {
  try {
    var stored = localStorage.getItem('av-theme');
    var prefersDark = window.matchMedia &&
                      window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = (stored === 'light' || stored === 'dark')
                ? stored
                : (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();

// Byte-faithful to profile.html: prod credentials are the FALLBACK — the
// generated runtime-config (loaded before api.js) wins on Vercel, which is
// what keeps Preview/staging off the production Supabase (ADR-006).
const SUPABASE_INIT = `
var SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
var SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
document.addEventListener('DOMContentLoaded', function () {
  if (typeof initSupabase === 'function') {
    initSupabase(SUPABASE_URL, SUPABASE_ANON);
  }
});
`.trim();

// Lucide hydration (chrome glyphs) — verbatim from profile.html.
const LUCIDE_HYDRATE = `
(function () {
  function hydrateIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateIcons);
  } else {
    hydrateIcons();
  }
  window.addEventListener('load', hydrateIcons);
})();
`.trim();

export default function AuthedHomeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH }} suppressHydrationWarning />

      {/* Font preconnects + faces — profile.html set, NOT the public-content set */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />

      {/* Aver Design System cascade (tokens before components before page CSS;
          static Tailwind LAST so utilities/.hidden win — P0-3 C-3.4) */}
      <link rel="stylesheet" href="/css/aver-design/tokens.css" />
      <link rel="stylesheet" href="/css/aver-design/components.css" />
      <link rel="stylesheet" href="/css/ds.css" />
      <link rel="stylesheet" href="/css/home.css" />
      {/* Mock hub: cùng MỘT nguồn với trang legacy (review #929). */}
      <link rel="stylesheet" href="/css/mock-hub.css" />
      <link rel="stylesheet" href="/css/tailwind.build.css" />

      {/* Same CDN pins as legacy (lucide@1.17.0, supabase-js@2.107.0) */}
      <script src="https://unpkg.com/lucide@1.17.0" defer />
      <script
        src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js"
        defer
      />
      <script src="/js/runtime-config.js" defer />
      {/* DEBT-2026-07-31-O — reporter phải nạp TRƯỚC api.js/chrome. Script
          `defer` chạy theo THỨ TỰ TÀI LIỆU, nên đặt sau api.js thì một lỗi
          trong api.js xảy ra khi listener chưa gắn — đúng khoảng mù mà bản vá
          này nhận đóng (review #887). Reporter đọc runtime-config lúc GỬI chứ
          không lúc nạp, nên đứng ngay sau runtime-config là an toàn. */}
      <script src="/js/error-reporter.js" defer />
      <script src="/js/api.js" defer />
      {/* Bộ ba telemetry của cổng rollback (ADR-012): error-reporter ở trên =
          TỬ SỐ; analytics-beacon = MẪU SỐ page_view; rum-vitals = trigger LCP. */}
      <script src="/js/analytics-beacon.js" defer />
      {/* AUDIT F2: field Web Vitals per implementation tag (rollback-metrics
          reads them for the frozen LCP trigger). */}
      <script src="/js/rum-vitals.js" defer />
      {/* `speaking-debt.js` chỉ ĐỊNH NGHĨA `window.SpeakingDebt` — không tự gọi
          API nào lúc nạp — nên nạp bằng thẻ script là an toàn.
          `home-behavior.tsx` gọi `retryAll()` sau khi home-summary trả về:
          practice.js chỉ nạp ở trang luyện tập, nên học viên đóng tab hoàn thành
          rồi quay lại ĐÂY — đường về bình thường sau kỳ thi — sẽ để lượt thi kẹt
          ở `speaking_pending` mãi mãi (Codex review, PR #847).

          KHÔNG nạp `home-mock-tiles.js` ở đây, dù bản legacy có. Nó TỰ CHẠY lúc
          `DOMContentLoaded` và gọi ngay `/api/mock-exams/my-sittings`. Trên trang
          legacy thứ tự script bảo đảm `initSupabase` đã chạy trước; trong Next
          mọi script ngoài đều `defer` còn script nội tuyến chạy lúc parse, nên
          nó bắn request TRƯỚC khi phiên sẵn sàng → 401 → `api.js:130` đẩy sang
          `/login.html` và CẢ TRANG biến mất. Cổng parity authed bắt đúng vậy:
          `title-mismatch: Trang chủ → Đăng nhập`, 68 phát hiện. Logic của tệp đó
          đã port vào `home-behavior.tsx`, chạy sau khi xác nhận đăng nhập. */}
      <script src="/js/speaking-debt.js" defer />
      <script dangerouslySetInnerHTML={{ __html: SUPABASE_INIT }} />
      <script dangerouslySetInnerHTML={{ __html: LUCIDE_HYDRATE }} />

      {/* Canonical chrome Web Component (Sprint 7.13) */}
      <script type="module" src="/js/components/aver-chrome.js" />

      {/* profile.css / ds.css scope page rules under body classes — React must
          not own <body> attributes (root layout does), so classes are applied
          pre-paint with the same inline-script technique as the anti-flash
          IIFE (established in pilot 2, review #741). Exact legacy class list:
          profile.html <body class="av-page font-sans min-h-screen">. */}
      <script
        dangerouslySetInnerHTML={{
          __html: "document.body.className += ' av-page font-sans min-h-screen';",
        }}
      />
      <AuthProvider>{children}</AuthProvider>
    </>
  );
}
