// Route-group cần đăng nhập cho `/speaking/result`.
//
// `/css/speaking-result.css` là tệp vừa tách khỏi `<style>` inline của bản
// legacy — cả hai vế nạp CÙNG tệp, nên cổng parity so được nội dung thật.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function SpeakingResultLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/speaking-result.css']}>{children}</AuthedShell>
  );
}
