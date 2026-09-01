import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedQuizPlayerLayout({ children }: { children: ReactNode }) {
  return <AuthedShell pageStylesheets={['/css/quiz-player.css']}>{children}</AuthedShell>;
}
