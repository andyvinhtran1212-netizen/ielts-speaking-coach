// Khung `<head>` + bootstrap dùng chung cho MỌI route-group cần đăng nhập.
//
// VÌ SAO TÁCH RA: `(authed)` (profile) và `(authed-home)` (trang chủ) trước đây
// là hai tệp gần như trùng nhau — khác ĐÚNG danh sách stylesheet của trang và
// một thẻ script. Nợ đó đã ghi trong chính hai tệp ấy. Đến trang thứ ba
// (`/speaking`) thì chép lần nữa là sai hẳn: mỗi bài học sau này (thứ tự script
// `defer`, reporter phải đứng trước api.js, lucide đua với hydrate…) sẽ phải
// vá ở ba chỗ, và chỉ cần quên một chỗ là trang đó âm thầm khác các trang kia.
//
// VÌ SAO KHÔNG GỘP CẢ STYLESHEET VÀO MỘT DANH SÁCH CỐ ĐỊNH: `home.css` có LUẬT
// TOÀN CỤC (`* { box-sizing }`, `html, body`, `a`) còn `profile.css` và
// `speaking.css` thì KHÔNG (đếm được: 0). Nạp home.css lên `/profile` là đổ ba
// luật đó lên một trang đang chạy. Nên stylesheet-của-trang là THAM SỐ, còn
// THỨ TỰ cascade thì cố định ở đây: tokens → components → ds → <trang> →
// tailwind LAST (P0-3 C-3.4, để utilities/.hidden thắng).
//
// VÌ SAO KHÔNG DÙNG React 19 `<link precedence>` TỪ TRANG: cách đó gộp được
// triệt để hơn, nhưng nó đổi thứ tự cascade của những trang ĐANG SỐNG. Để sau,
// làm có chủ đích, có ảnh chụp so sánh.
//
// HỢP ĐỒNG: component này phải phát ra markup Y HỆT bản chép tay trước đó —
// `tests/authed-shell.test.mjs` ghim điều đó, và bản refactor đã được kiểm bằng
// cách so BYTE HTML của `/profile` và `/home` trước/sau.
import type { ReactNode } from 'react';
import Script from 'next/script';

import { BodyClassBridge } from '@/components/body-class-bridge';
import { NextPageViewBeacon } from '@/components/next-page-view-beacon';
import { SupabaseRuntimeBoundary } from '@/components/supabase-runtime-boundary';
import { AuthProvider } from '@/lib/auth/auth-provider';

type PageStylesheet =
  | string
  | {
      href: string;
      /** Prevents aver-admin-chrome from appending this stylesheet again. */
      dataAverAdminSurface?: boolean;
    };

// Bootstrap chống nháy theme (DESIGN_SYSTEM §13) — phải chạy TRƯỚC mọi
// stylesheet để `[data-theme]` có mặt trên <html> trước lượt vẽ đầu tiên.
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

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

const SUPABASE_RUNTIME_SCRIPTS = [
  {
    src: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js',
    continueOnError: true,
  },
  { src: '/js/supabase-sdk-fallback.js' },
  { src: '/js/runtime-config.js' },
  { src: '/js/error-reporter.js', continueOnError: true },
  { src: '/js/api.js' },
] as const;

export function AuthedShell({
  pageStylesheets,
  extraScripts,
  utilityLayer = true,
  tailwindLayer = utilityLayer,
  chrome = 'student',
  authGated = true,
  bodyClass = 'av-page font-sans min-h-screen',
  children,
}: {
  /**
   * CSS riêng của trang, chèn giữa `ds.css` và `tailwind.build.css`.
   * Nhiều tệp thì theo đúng thứ tự trang legacy nạp chúng.
   */
  pageStylesheets: PageStylesheet[];
  /**
   * Thẻ script thêm cho riêng route-group. CHỈ dùng cho script KHÔNG tự gọi
   * API lúc nạp — một script tự-khởi-động-và-gọi-API sẽ bắn request trước khi
   * phiên sẵn sàng → 401 → `api.js:130` đẩy sang `/login` và CẢ TRANG biến
   * mất (đã xảy ra thật với `home-mock-tiles.js`, cổng parity bắt được ở PR
   * #930). Loại đó phải port vào tầng behavior, chạy sau khi xác nhận đăng nhập.
   */
  extraScripts?: ReactNode;
  /**
   * Nạp `ds.css` + `tailwind.build.css` hay không. MẶC ĐỊNH có, vì ba trang
   * port trước đều cần utilities.
   *
   * ĐẶT `false` cho trang legacy KHÔNG nạp hai tệp đó. Không phải chuyện gọn
   * gàng — lớp reset của Tailwind ĐỔI GIAO DIỆN: `h1 { font-weight: inherit }`,
   * `a { text-decoration: inherit }`, `h1,p { margin: 0 }`. Đo trên
   * `/reading/vocab`: tiêu đề thành 400 thay vì 700, link mất gạch chân, và 2
   * chỗ lề khác đi — 5 phần tử lệch tổng cộng. Không phép so DOM nào bắt được
   * vì cấu trúc y hệt, chỉ style tính ra khác (Codex nêu h1 ở #951; bốn cái
   * còn lại tìm ra khi quét toàn trang bằng `getComputedStyle`).
   */
  utilityLayer?: boolean;
  /**
   * Tailwind utilities can be retained without `ds.css` for legacy admin
   * surfaces whose measured cascade is tokens → components → page CSS →
   * Tailwind. Defaults to `utilityLayer` so every existing route is byte-stable.
   */
  tailwindLayer?: boolean;
  /** Shared coexistence chrome. Admin routes use the canonical admin component. */
  chrome?: 'student' | 'admin' | 'none';
  /**
   * Whether the whole route requires a signed-in account. Hybrid surfaces can
   * still consume AuthProvider while leaving their public modes accessible.
   */
  authGated?: boolean;
  /**
   * Class gắn vào `<body>`. Mặc định giữ nguyên chuỗi cũ để ba trang đã port
   * không đổi. Trang legacy có body class KHÁC NHAU (`reading-vocab` chỉ có
   * `av-page`, `speaking` có tận sáu class) nên nó phải là tham số; ghi cứng
   * một chuỗi là ép mọi trang giống nhau bất kể bản gốc.
   */
  bodyClass?: string;
  children: ReactNode;
}) {
  return (
    <>
      {/* Route-scoped hint for the adaptive student chrome. Without it the
          Vocabulary target waits on a second Supabase poll and can briefly
          disagree with an authenticated native page. */}
      {authGated && <meta name="aver-auth-gated" content="1" />}
      <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH }} suppressHydrationWarning />

      {/* Font preconnects + faces — bộ của trang cần đăng nhập, KHÔNG phải bộ
          của khu nội dung công khai */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />

      {/* Cascade của Aver Design System (tokens trước components trước CSS
          trang; Tailwind tĩnh CUỐI CÙNG để utilities/.hidden thắng — P0-3 C-3.4) */}
      <link rel="stylesheet" href="/css/aver-design/tokens.css" />
      <link rel="stylesheet" href="/css/aver-design/components.css" />
      {utilityLayer && <link rel="stylesheet" href="/css/ds.css" />}
      {pageStylesheets.map((stylesheet) => {
        const href = typeof stylesheet === 'string' ? stylesheet : stylesheet.href;
        const dataAverAdminSurface = typeof stylesheet === 'string'
          ? undefined
          : stylesheet.dataAverAdminSurface
            ? '1'
            : undefined;
        return (
          <link
            key={href}
            rel="stylesheet"
            href={href}
            data-aver-admin-surface={dataAverAdminSurface}
          />
        );
      })}
      {tailwindLayer && <link rel="stylesheet" href="/css/tailwind.build.css" />}

      {/* Next Script executes on hard load and App Router client navigation.
          Lucide is independent; auth/API globals below remain strictly
          ordered and fail closed before route-specific scripts are exposed. */}
      <Script src="https://unpkg.com/lucide@1.17.0" strategy="afterInteractive" />
      <SupabaseRuntimeBoundary
        scripts={SUPABASE_RUNTIME_SCRIPTS}
        supabaseUrl={SUPABASE_URL}
        supabaseAnonKey={SUPABASE_ANON}
      >
        {extraScripts}
        <NextPageViewBeacon />
        <Script src="/js/rum-vitals.js" strategy="afterInteractive" />
        {chrome === 'student' && (
          <Script type="module" src="/js/components/aver-chrome.js" strategy="afterInteractive" />
        )}
        {chrome === 'admin' && (
          <Script type="module" src="/js/components/aver-admin-chrome.js" strategy="afterInteractive" />
        )}
      </SupabaseRuntimeBoundary>

      {/* CSS trang / ds.css bọc luật dưới class của <body> — React KHÔNG được
          sở hữu thuộc tính của <body> (root layout mới sở hữu), nên class được
          gắn trước lượt vẽ bằng đúng kỹ thuật script nội tuyến của khối
          anti-flash (dựng ở pilot 2, review #741). Danh sách class đúng như
          trang legacy: `<body class="av-page font-sans min-h-screen">`. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.body.className += ' ${bodyClass}';`,
        }}
      />
      <BodyClassBridge className={bodyClass} />
      <AuthProvider>{children}</AuthProvider>
    </>
  );
}
