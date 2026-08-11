// Route-group của trang Từ vựng luyện thi (`/vocabulary/exam`).
//
// `pageStylesheets` để RỖNG và `utilityLayer` giữ mặc định (có tailwind): bản
// legacy nạp tokens → components → tailwind → CSS trang, tức CSS trang đứng SAU
// tailwind. `AuthedShell` chèn `pageStylesheets` TRƯỚC tailwind, nên nếu đưa
// `vocab-exam.css` vào đây thì thứ tự bị đảo và lớp reset của Tailwind sẽ đè
// lên luật của trang. Vì vậy `page.tsx` tự nhả tệp CSS đó — giống nhóm Listening
// có tailwind (`/listening`, `/listening/browse`, `/listening/analytics`).
//
// `ds.css` KHÔNG nạp vì bản legacy cũng không nạp; `utilityLayer` gộp cả hai nên
// ở đây nó bật, và `page.tsx` chịu trách nhiệm thứ tự phần còn lại.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedVocabExamLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={[]}
      // Đúng như bản legacy: `<body class="av-page font-sans antialiased">`.
      bodyClass="av-page font-sans antialiased"
    >
      {children}
    </AuthedShell>
  );
}
