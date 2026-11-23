// Old admin routes that the new frame replaces (ADMINIA-0074 FR-010; G09-T16).
// Only under ADMIN_FRAME_V2=1, read per request: with the flag off every old
// page opens as before. The target is the registry row's `redirectTo`.
import { redirect } from 'next/navigation';

import { adminRouteFor } from '@/lib/admin-nav-registry.mjs';

export function redirectUnderAdminFrameV2(pattern: string): void {
  if (process.env.ADMIN_FRAME_V2 !== '1') return;
  const target = adminRouteFor(pattern)?.redirectTo;
  if (target) redirect(target); // 307
}
