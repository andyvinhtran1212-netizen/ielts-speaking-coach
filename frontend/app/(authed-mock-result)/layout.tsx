// Route-group cần đăng nhập cho `/mock/result`.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function MockResultLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/mock-result.css']}>{children}</AuthedShell>
  );
}
