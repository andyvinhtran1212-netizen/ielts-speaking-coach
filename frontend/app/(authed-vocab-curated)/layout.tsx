import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function VocabCuratedLayout({ children }: { children: ReactNode }) {
  return <AuthedShell pageStylesheets={['/css/vocab-curated.css']}>{children}</AuthedShell>;
}
