// Route-group cần đăng nhập cho `/speaking/result`.
//
// `/css/speaking-result.css` vẫn dùng chung với bản legacy trong cửa sổ
// parity/rollback; behavior của route production đã thuộc React.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function SpeakingResultLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/speaking-result.css']}>{children}</AuthedShell>
  );
}
