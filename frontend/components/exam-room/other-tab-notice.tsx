'use client';

// EXAMROOM-0066 FR-017: this tab is read-only because another tab of the same
// browser holds the write right; "Use this tab" asks for it, "Reload" starts over
// when the other tab did not answer within five seconds.
import { Button } from '../ui/button';
import { Notice } from '../ui/notice';
import type { ExamRoomStrings } from './strings';

export type TabGuardState = 'pending' | 'writer' | 'read-only' | 'releasing' | 'acquiring' | 'stuck' | 'unsupported';

export function OtherTabNotice({ state, strings, onTakeover, onReload }: {
  state: TabGuardState; strings: ExamRoomStrings; onTakeover(): void; onReload(): void;
}) {
  const lang = strings.lang === 'en' ? 'en' : 'vi';
  if (state === 'read-only') {
    return (
      <Notice kind="warning" lang={lang} action={<Button variant="secondary" size="sm" onClick={onTakeover}>{strings.useThisTab}</Button>}>
        {strings.otherTab}
      </Notice>
    );
  }
  if (state === 'stuck') {
    return (
      <Notice kind="warning" lang={lang} action={<Button variant="secondary" size="sm" onClick={onReload}>{strings.reload}</Button>}>
        {strings.otherTabStuck}
      </Notice>
    );
  }
  return null;
}
