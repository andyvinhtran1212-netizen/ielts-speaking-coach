// Clock text for the audio and video players (UIBASE-0056 #31, #32; HocTap §2–3).
// "phút:giây" with tabular digits; hours only appear for media of an hour or more.

function clampSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

/**
 * `72` → `"1:12"`; with `padMinutes` → `"01:12"` (the video sheet writes 06:12);
 * `3725` → `"1:02:05"`. Negative, NaN or Infinity read as 0.
 */
export function formatMediaTime(seconds: number, { padMinutes = false }: { padMinutes?: boolean } = {}): string {
  const total = clampSeconds(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${s}`;
  return `${padMinutes ? String(m).padStart(2, '0') : m}:${s}`;
}

/** `0.75` → `"0,75×"` (Vietnamese decimal comma, as on the sheet). */
export function formatSpeed(speed: number): string {
  return `${String(speed).replace('.', ',')}×`;
}
