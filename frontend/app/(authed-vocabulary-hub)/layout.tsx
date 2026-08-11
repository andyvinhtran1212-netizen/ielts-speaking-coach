// Route-group cần đăng nhập cho `/vocabulary/hub`.
//
// Ba stylesheet RIÊNG của trang, đúng thứ tự bản legacy nạp chúng:
// vocabulary.css → flashcards.css → exercises.css (tokens/components/tailwind do
// `AuthedShell` lo).
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function VocabularyHubLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/vocabulary.css', '/css/flashcards.css', '/css/exercises.css']}
    >
      {children}
    </AuthedShell>
  );
}
