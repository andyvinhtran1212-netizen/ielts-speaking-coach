'use client';

// EXAMROOM-0066 FR-014: the strip above the work while offline, then "Back
// online" for five seconds once the queue has drained. Never covers an answer.
import { connectionBanner } from '@/lib/exam-room/connection-state.mjs';

import { Notice } from '../ui/notice';
import type { ExamRoomStrings } from './strings';

type ConnectionState = Parameters<typeof connectionBanner>[0];

export function ConnectionBanner({ state, strings, savedUpTo }: { state: ConnectionState; strings: ExamRoomStrings; savedUpTo: string | null }) {
  const banner = connectionBanner(state, strings, savedUpTo);
  if (!banner) return null;
  return (
    <Notice kind={banner.tone === 'warning' ? 'warning' : 'success'} lang={strings.lang === 'en' ? 'en' : 'vi'} live="status">
      {banner.text}
    </Notice>
  );
}
