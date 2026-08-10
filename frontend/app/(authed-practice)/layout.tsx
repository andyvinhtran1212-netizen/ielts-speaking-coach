// Route-group riêng cho Speaking core dark route `/practice/session`.
//
// Đây là hybrid có chủ đích, chưa phải native player hoàn chỉnh: App Router sở
// hữu URL, JSX shell, auth, bootstrap session/question, recorder, submission và
// Full Test lifecycle; `practice.js` vẫn sở hữu dynamic DOM rendering và phần
// orchestration còn lại. Tách group để
// CSS/script của player XL không tràn sang `/speaking`.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedPracticeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/practice.css', '/css/speaking-assignment.css']}
      bodyClass="av-page font-sans antialiased min-h-screen flex flex-col"
      extraScripts={
        <>
          {/* Thứ tự byte-faithful với practice.html. Ba tệp chỉ định nghĩa
              global/listener; PracticeSessionBoot mới tải payload đã xác thực
              rồi handoff vào init sau khi các global sẵn sàng. */}
          <script src="/js/speaking-debt.js" defer />
          <script src="/js/practice.js" defer />
          <script src="/js/pronunciation-drilldown.js" defer />
        </>
      }
    >
      {children}
    </AuthedShell>
  );
}
