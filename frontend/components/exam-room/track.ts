// EXAMROOM-0066 FR-033: exam room events through the existing
// POST /api/analytics/events. Best effort: never throws, never sends answer
// text or learner details, and never bounces the room to /login on a 401.
export type ExamRoomEventName =
  | 'exam_room_submit_dialog_opened'
  | 'exam_room_submit_confirmed'
  | 'exam_room_exit_confirmed'
  | 'exam_room_offline'
  | 'exam_room_session_expired'
  | 'exam_room_other_tab';

export function trackExamRoomEvent(name: string, props: Record<string, string | number | boolean> = {}): void {
  try {
    const api = typeof window === 'undefined' ? undefined : window.api;
    if (!api?.postWith) return;
    void api.postWith('/api/analytics/events', { event_name: name, event_data: props }, undefined, { noRedirect: true })
      .catch(() => undefined);
  } catch {
    // Telemetry must never affect the test.
  }
}
