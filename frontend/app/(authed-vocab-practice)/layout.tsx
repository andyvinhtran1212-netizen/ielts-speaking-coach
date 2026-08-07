// Route-group cần đăng nhập cho `/vocabulary/practice`.
//
// `/css/vocab-practice.css` là tệp vừa tách khỏi `<style>` inline của bản legacy
// — cả hai vế nạp CÙNG tệp, nên cổng parity so được nội dung thật.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function VocabPracticeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/vocab-practice.css']}>{children}</AuthedShell>
  );
}
