// Root layout — deliberately minimal during coexistence (plan §4.2/ADR-004):
// no auth, no cookies/headers reads (keeps the public tree static), no
// providers until the first real migrated route needs them.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Bản sao chia sẻ (fan page → web). Facebook/Zalo/LinkedIn đọc og:*; thiếu
// og:image thì thẻ preview về dạng text nhỏ, CTR thấp hơn hẳn thẻ ảnh lớn.
//
// Vì sao đặt ở ROOT chứ không ở trang landing: merge metadata của Next là
// SHALLOW — một segment con khai `openGraph` sẽ THAY THẾ trọn gói object này,
// và og:title KHÔNG tự suy ra từ `title` của page (docs "Inheriting fields":
// layout og:title thắng title của page con). Đặt ở root + không segment nào
// khai openGraph ⇒ mọi route Next dùng đúng một bản sao, xác định được.
//
// og:image KHÔNG khai ở đây: `app/opengraph-image.jpg` là file-based metadata,
// vốn có ưu tiên CAO HƠN object này và tự sinh og:image + twitter:image kèm
// width/height. Khai tay ở đây chỉ tạo hai nguồn sự thật rồi lệch nhau.
const SHARE_TITLE = 'Aver Learning — Luyện IELTS toàn diện cùng AI';
const SHARE_DESCRIPTION =
  '6 kỹ năng IELTS — Speaking, Writing, Reading, Listening, Grammar và Từ vựng — trên một nền tảng. Phản hồi chi tiết theo từng tiêu chí sau mỗi buổi luyện.';

export const metadata: Metadata = {
  // metadataBase: bắt buộc để `opengraph-image.jpg` và og:url nở thành URL
  // tuyệt đối. Không có nó, Next build lỗi với đường dẫn tương đối, hoặc rơi
  // về localhost/VERCEL_URL — tức preview trên Facebook trỏ vào deployment
  // preview thay vì domain thật.
  metadataBase: new URL('https://averlearning.com'),
  title: 'averlearning',
  description: SHARE_DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'Aver Learning',
    locale: 'vi_VN',
    url: '/',
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
  },
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
