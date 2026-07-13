// Root layout — deliberately minimal during coexistence (plan §4.2/ADR-004):
// no auth, no cookies/headers reads (keeps the public tree static), no
// providers until the first real migrated route needs them.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'averlearning',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: route-group layouts mutate <html>/<body>
  // attributes BEFORE hydration by design (anti-flash [data-theme] IIFE,
  // pre-paint legacy body classes — pilot 2 review #741). React must not
  // flag those as mismatches; it never patches attributes anyway. Standard
  // next-themes pattern.
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
