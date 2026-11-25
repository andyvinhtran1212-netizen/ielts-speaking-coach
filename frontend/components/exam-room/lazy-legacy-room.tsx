// EXAMDRILL-0073: lazy-load a practice room for a legacy route group, wrapped in
// LegacyRoomRoot (av2-root, font variables, tokens.css and base.css). Every G08
// room that sits on a route group without the new-UI layout should load through
// this, so flag-off pages keep the same assets and the room keeps its look.
import { lazy, type ComponentType } from 'react';

export function lazyLegacyRoom<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async () => {
    const [Room, { LegacyRoomRoot }] = await Promise.all([load(), import('./legacy-room-root')]);
    function LegacyRoom(props: P) {
      return <LegacyRoomRoot><Room {...props} /></LegacyRoomRoot>;
    }
    return { default: LegacyRoom };
  });
}
