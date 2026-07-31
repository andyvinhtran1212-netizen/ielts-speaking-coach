// Root layout — deliberately minimal during coexistence (plan §4.2/ADR-004):
// no auth, no cookies/headers reads (keeps the public tree static), no
// providers until the first real migrated route needs them.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'averlearning',
};

// DEBT-2026-07-30-N — dấu vết release ĐI CÙNG TÀI LIỆU.
//
// `release` mà telemetry gửi lên đọc từ `/js/runtime-config.js`, tức một file
// RỜI: nếu client chạy bản cache cũ thì thẻ đó nói dối, và quy kết một-biến của
// ADR-012 mất chỗ dựa. Đợt pilot 2 gặp đúng ca này — 2 mẫu vitals mang release
// của 13 ngày trước — mà không kết luận được vì hai giả thuyết (asset bị cache
// / tab mở lâu) cùng khớp dữ liệu.
//
// Giá trị dưới đây được nướng vào CHÍNH tài liệu lúc build, nên nó luôn khớp
// deployment đã sinh ra trang. So `doc_release` (ở đây) với `release` (từ
// runtime-config) là phép thử phân biệt: khác nhau ⇒ asset rời bị cache cũ.
const DOC_RELEASE = process.env.VERCEL_GIT_COMMIT_SHA || null;

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: route-group layouts mutate <html>/<body>
  // attributes BEFORE hydration by design (anti-flash [data-theme] IIFE,
  // pre-paint legacy body classes — pilot 2 review #741). React must not
  // flag those as mismatches; it never patches attributes anyway. Standard
  // next-themes pattern.
  return (
    <html lang="vi" data-release={DOC_RELEASE ?? undefined} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
