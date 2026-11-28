// Old admin routes that the new frame replaces (ADMINIA-0074 FR-010; G09-T16,
// G09-T10). Only under ADMIN_FRAME_V2=1, read per request: with the flag off
// every old page opens as before. The target is the registry row's
// `redirectTo`; `keep` carries named query values over (`?q=` for the
// learner directory).
import { notFound, redirect } from 'next/navigation';

import { adminRouteFor } from '@/lib/admin-nav-registry.mjs';

export function redirectUnderAdminFrameV2(pattern: string, keep: Record<string, string | undefined> = {}): void {
  if (process.env.ADMIN_FRAME_V2 !== '1') return;
  const target = adminRouteFor(pattern)?.redirectTo;
  if (!target) return;
  const url = new URL(target, 'http://admin.local');
  for (const [key, value] of Object.entries(keep)) if (value) url.searchParams.set(key, value);
  redirect(`${url.pathname}${url.search}`); // 307
}

/** A page of the new frame (G09-T16 inbox, G09-T10 directory): 404 while ADMIN_FRAME_V2 is off. */
export function requireAdminFrameV2(): void {
  if (process.env.ADMIN_FRAME_V2 !== '1') notFound();
}
