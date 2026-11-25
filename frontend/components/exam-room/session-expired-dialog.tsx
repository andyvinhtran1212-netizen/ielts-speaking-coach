'use client';

// EXAMROOM-0066 FR-015 / FR-016, fallback until G05-T19/T20 reach staging
// (T004a swaps this box for the real sign-in component). A blocking box: the
// copy was written before it opened; "Sign in again" opens /login?next=<room URL>
// in the same tab. The timer keeps running behind it.
// Amendment 2: when the copy could not be read back and the server still lacks
// some answers, nothing is secured, so the box offers only "Stay" (it closes and
// the page stays); no same-tab sign-in that would drop the in-memory answers.
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import type { ExamRoomStrings } from './strings';

export function loginHref(returnUrl: string): string {
  return `/login?next=${encodeURIComponent(returnUrl)}`;
}

export function SessionExpiredDialog({ open, copySaved, stayOnly, onStay, savedUpTo, returnUrl, strings }: {
  open: boolean; copySaved: boolean; stayOnly: boolean; onStay(): void;
  savedUpTo: string | null; returnUrl: string; strings: ExamRoomStrings;
}) {
  const lang = strings.lang === 'en' ? 'en' : undefined;
  return (
    <Dialog
      open={open}
      dismissible={false}
      onClose={() => {}}
      role="alertdialog"
      title={strings.sessionExpiredTitle}
      tone={copySaved ? 'default' : 'warning'}
      actions={stayOnly
        ? <Button onClick={onStay}>{strings.shell.sessionStay}</Button>
        : <Button href={loginHref(returnUrl)}>{strings.signInAgain}</Button>}
    >
      {stayOnly ? null : <p lang={lang}>{strings.sessionExpiredBody(savedUpTo)}</p>}
      {copySaved ? null : <p lang={lang}>{strings.sessionExpiredNoCopy(savedUpTo)}</p>}
    </Dialog>
  );
}
