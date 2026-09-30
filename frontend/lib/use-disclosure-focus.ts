'use client';

import { useEffect, type KeyboardEvent, type RefObject } from 'react';

/** Keyboard lifecycle for an inline detail panel: focus, Escape and restore. */
export function useDisclosureFocus({ identity, headingRef, onClose, busy = false }: {
  identity: string | null;
  headingRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  busy?: boolean;
}) {
  useEffect(() => {
    if (!identity) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      if (origin?.isConnected) origin.focus();
    };
  }, [identity, headingRef]);

  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || busy) return;
    event.preventDefault(); event.stopPropagation(); onClose();
  };
}
