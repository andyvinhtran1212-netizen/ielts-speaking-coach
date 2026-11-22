'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Which overlay of the learner top bar is open (UIBASE-0056 FR-007): the quick
 * lookup, the notifications drawer, the account menu, or the tablet section
 * menu. Opening one closes the others, so at most one is open at a time.
 * G11-T11's bell (passed as `notificationsSlot`) joins through
 * `useLearnerShellPanel('notifications')`.
 */
export type LearnerPanel = 'lookup' | 'notifications' | 'account' | 'menu';

type PanelContext = { open: LearnerPanel | null; setOpen: (panel: LearnerPanel | null) => void };

const Ctx = createContext<PanelContext>({ open: null, setOpen: () => {} });

export function LearnerPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<LearnerPanel | null>(null);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `[isOpen, setOpen]` for one panel; `setOpen(true)` closes any other panel. */
export function useLearnerShellPanel(panel: LearnerPanel): [boolean, (next: boolean) => void] {
  const { open, setOpen } = useContext(Ctx);
  const set = useCallback((next: boolean) => {
    if (next) setOpen(panel);
    else setOpen(open === panel ? null : open);
  }, [open, panel, setOpen]);
  return [open === panel, set];
}
