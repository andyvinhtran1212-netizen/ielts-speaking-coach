// Route-group của các trang Listening (`/listening/*`).
//
// Group riêng vì CSS riêng (`listening.css`), cùng lý do đã ghi ở
// `(authed-speaking)` và `(authed-reading)`.
//
// `utilityLayer={false}` + `bodyClass="av-page"`: trang legacy KHÔNG nạp
// `ds.css`/`tailwind.build.css`, và lớp reset của Tailwind đổi giao diện thật —
// đo được trên `/reading/vocab`: h1 700→400, link mất gạch chân, 2 chỗ lề khác
// (PR #951). Body class cũng đúng như bản legacy: `<body class="av-page">`.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedListeningLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      // `listening-tests.css` tách từ khối <style> nội tuyến của trang legacy;
      // CẢ HAI vế cùng link nó. Thứ tự SAU `listening.css` đúng như vị trí cũ.
      pageStylesheets={['/css/listening.css', '/css/listening-tests.css']}
      utilityLayer={false}
      bodyClass="av-page"
    >
      {children}
    </AuthedShell>
  );
}
