// Route-group của trang Bài viết (`/writing/dashboard`).
//
// Vẫn là group RIÊNG chứ không nhét vào `(authed)`, cùng lý do đã ghi ở
// `(authed-speaking)`: khác biệt là CSS của trang. Trang này nạp HAI tệp
// (`writing-dashboard.css` + `markdown.css`) và cả hai chỉ có nghĩa ở đây.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedWritingLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      // Thứ tự y như bản legacy: writing-dashboard trước markdown.
      pageStylesheets={['/css/writing-dashboard.css', '/css/markdown.css']}
      extraScripts={
        <>
          {/* Ba script bản legacy nạp mà khung dùng chung không có, dùng để
              render phần "Mẹo viết" (body_markdown → HTML đã khử độc).
              Cùng pin CDN với bản legacy.

              THỨ TỰ QUAN TRỌNG: `markdown.js` gói `marked` + `DOMPurify` thành
              `window.renderMarkdown`, nên hai thư viện phải đứng TRƯỚC. Script
              `defer` chạy theo thứ tự tài liệu nên thứ tự viết ở đây là thứ tự
              chạy thật.

              Đã kiểm trước khi nạp (bài học `home-mock-tiles.js` ở PR #930):
              `markdown.js` chỉ định nghĩa global, không tự chạy và không gọi
              API lúc nạp. */}
          <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js" defer />
          <script src="https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js" defer />
          <script src="/js/markdown.js" defer />
        </>
      }
    >
      {children}
    </AuthedShell>
  );
}
