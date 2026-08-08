// Route-group cần đăng nhập cho `/quiz/progress`.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function QuizProgressLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/quiz-progress.css']}>{children}</AuthedShell>
  );
}
