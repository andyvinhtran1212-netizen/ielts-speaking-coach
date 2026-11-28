// Route group of /start, "Lần đầu vào" (LEARNERCORE-0063 FR-065, FR-090): a v2
// page on the "Bản in" tree. No LearnerShell here on purpose: the sheet keeps
// only the name and "Bỏ qua" at the top and no five-item bar while the learner
// goes through the steps (TroGiupLanDau screen 2 and 4), so the page draws its
// own top line.
import type { Viewport } from 'next';
import type { ReactNode } from 'react';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { AuthedShell } from '@/components/authed-shell';
import { AV2_VIEWPORT } from '@/components/ui/theme-color';
import { av2FontClass } from '@/styles/av2/fonts';

export const viewport: Viewport = AV2_VIEWPORT;

export default function AuthedStartLayout({ children }: { children: ReactNode }) {
  return (
    // `av2-root` on <body> too, so the paper reaches the window edges (base.css
    // drops the UA body margin there), same as the (public-v2) layout.
    <AuthedShell design="v2" chrome="none" bodyClass={`av2-root av2-body ${av2FontClass}`}>
      <div className={`av2-root ${av2FontClass}`}>{children}</div>
    </AuthedShell>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
