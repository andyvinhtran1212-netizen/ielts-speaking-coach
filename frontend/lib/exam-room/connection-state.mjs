// @ts-check
// EXAMROOM-0066 FR-014: connection banner state machine.
//   online ──offline / save-network-failure──▶ offline
//   offline ──online (unsaved left)──▶ syncing ──queue-drained──▶ back-online
//   offline ──online (nothing unsaved)──▶ back-online
//   back-online ──5 s (tick)──▶ online
// The timer keeps running throughout; only the manual submit button is locked
// while offline or syncing (submit-guard.mjs).

export const BACK_ONLINE_MS = 5000;

/**
 * @typedef {{ status: 'online' | 'offline' | 'syncing' | 'back-online', offlineSince: number | null, backOnlineUntil: number | null }} ConnectionState
 * @typedef {{ type: 'offline', at: number }
 *   | { type: 'save-network-failure', at: number }
 *   | { type: 'online', at: number, unsaved?: number }
 *   | { type: 'queue-drained', at: number }
 *   | { type: 'tick', at: number }} ConnectionEvent
 */

/** @param {boolean} [online] @returns {ConnectionState} */
export function initialConnectionState(online = true) {
  return { status: online ? 'online' : 'offline', offlineSince: online ? null : null, backOnlineUntil: null };
}

/**
 * Pure reducer. Returns the next state and, when the connection came back, the
 * offline duration for `exam_room_offline` (FR-033), in whole seconds.
 * @param {ConnectionState} state
 * @param {ConnectionEvent} event
 * @returns {{ state: ConnectionState, offlineDurationS: number | null }}
 */
export function connectionReducer(state, event) {
  switch (event.type) {
    case 'offline':
    case 'save-network-failure':
      if (state.status === 'offline') return { state, offlineDurationS: null };
      return { state: { status: 'offline', offlineSince: event.at, backOnlineUntil: null }, offlineDurationS: null };
    case 'online': {
      if (state.status !== 'offline') return { state, offlineDurationS: null };
      const offlineDurationS = state.offlineSince == null ? null : Math.max(0, Math.round((event.at - state.offlineSince) / 1000));
      if ((event.unsaved ?? 0) > 0) {
        return { state: { status: 'syncing', offlineSince: null, backOnlineUntil: null }, offlineDurationS };
      }
      return { state: { status: 'back-online', offlineSince: null, backOnlineUntil: event.at + BACK_ONLINE_MS }, offlineDurationS };
    }
    case 'queue-drained':
      if (state.status !== 'syncing') return { state, offlineDurationS: null };
      return { state: { status: 'back-online', offlineSince: null, backOnlineUntil: event.at + BACK_ONLINE_MS }, offlineDurationS: null };
    case 'tick':
      if (state.status === 'back-online' && state.backOnlineUntil != null && event.at >= state.backOnlineUntil) {
        return { state: { status: 'online', offlineSince: null, backOnlineUntil: null }, offlineDurationS: null };
      }
      return { state, offlineDurationS: null };
    default:
      return { state, offlineDurationS: null };
  }
}

/**
 * Banner text for the state. Syncing keeps the offline banner until the
 * queue has drained, so "Your work has been saved" is never said early.
 * @param {ConnectionState} state
 * @param {any} strings
 * @param {string | null} savedUpTo "HH:MM" of the last confirmed save
 * @returns {{ tone: 'warning' | 'success', text: string } | null}
 */
export function connectionBanner(state, strings, savedUpTo) {
  if (state.status === 'offline' || state.status === 'syncing') return { tone: 'warning', text: strings.offline(savedUpTo) };
  if (state.status === 'back-online') return { tone: 'success', text: strings.online };
  return null;
}

/** Whether the manual submit should treat the room as offline. @param {ConnectionState} state */
export function blocksManualSubmit(state) {
  return state.status === 'offline' || state.status === 'syncing';
}
