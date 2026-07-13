// Root layout — deliberately minimal during coexistence (plan §4.2/ADR-004):
// no auth, no cookies/headers reads (keeps the public tree static), no
// providers until the first real migrated route needs them.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'averlearning',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
