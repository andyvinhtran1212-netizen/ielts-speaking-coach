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
      // CHỈ CSS chung của domain ở đây. CSS RIÊNG của từng trang do chính
      // `page.tsx` nhả ra, vì bốn trang trong nhóm ĐỊNH NGHĨA LẠI cùng những
      // selector (`.lt-card`, `.empty-state`, `[hidden]` — đo được: cả 6 cặp
      // đều chồng nhau). Nạp hết ở layout thì tệp cuối thắng và đổi giao diện
      // các trang anh em. Trang legacy cũng chỉ nạp đúng CSS của nó.
      pageStylesheets={['/css/listening.css']}
      utilityLayer={false}
      bodyClass="av-page"
    >
      {children}
    </AuthedShell>
  );
}
