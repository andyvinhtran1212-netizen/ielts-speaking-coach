import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function D1ExerciseLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/d1-exercise-next.css']}>
      {children}
    </AuthedShell>
  );
}
