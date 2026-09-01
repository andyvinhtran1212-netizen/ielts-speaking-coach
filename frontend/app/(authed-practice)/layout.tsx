// Route-group riêng cho Speaking core dark route `/practice/session`.
//
// Đây là hybrid có chủ đích, chưa phải native player hoàn chỉnh: App Router sở
// hữu URL, JSX shell, auth, bootstrap session/question, recorder, submission và
// Full Test lifecycle; `practice.js` vẫn sở hữu dynamic DOM rendering và phần
// orchestration còn lại. Tách group để
// CSS/script của player XL không tràn sang `/speaking`.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';
import { PracticeRuntimeScripts } from './practice-runtime-scripts';

export default function AuthedPracticeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/practice.css', '/css/speaking-assignment.css']}
      bodyClass="av-page font-sans antialiased min-h-screen flex flex-col"
      extraScripts={
        /* Raw script tags do not execute when this layout is entered through
           App Router navigation. The client loader preserves source order on
           both first-document and soft-navigation entry. */
        <PracticeRuntimeScripts />
      }
    >
      {children}
    </AuthedShell>
  );
}
