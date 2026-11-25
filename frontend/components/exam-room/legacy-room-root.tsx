// EXAMDRILL-0073: the "Bản in" root for a practice room shown on a legacy route
// group. Those layouts load neither the av2 tokens, base.css nor the two font
// families (UIBASE-0056 FR-003/FR-004 keep their <head> as it was), so the room
// brings them itself. Only lazyLegacyRoom() imports this module, inside the
// room's lazy chunk: pages with the flag off never download any of it.
import type { ReactNode } from 'react';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { av2FontClass } from '@/styles/av2/fonts';

export function LegacyRoomRoot({ children }: { children: ReactNode }) {
  return <div className={`av2-root ${av2FontClass}`} data-legacy-room-root="">{children}</div>;
}
