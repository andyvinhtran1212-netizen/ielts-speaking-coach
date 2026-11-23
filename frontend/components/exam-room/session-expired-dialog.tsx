'use client';

// EXAMROOM-0066 FR-015 / FR-016, fallback until G05-T19/T20 reach staging
// (T004a swaps this box for the real sign-in component). A blocking box: the
// copy was written before it opened; "Sign in again" opens /login?next=<room URL>
// in the same tab. The timer keeps running behind it.
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import type { ExamRoomStrings } from './strings';

export function loginHref(returnUrl: string): string {
  return `/login?next=${encodeURIComponent(returnUrl)}`;
}

export function SessionExpiredDialog({ open, copySaved, savedUpTo, returnUrl, strings }: {
  open: boolean; copySaved: boolean; savedUpTo: string | null; returnUrl: string; strings: ExamRoomStrings;
}) {
  return (
    <Dialog
      open={open}
      dismissible={false}
      onClose={() => {}}
      role="alertdialog"
      title={strings.sessionExpiredTitle}
      tone={copySaved ? 'default' : 'warning'}
      actions={<Button href={loginHref(returnUrl)}>{strings.signInAgain}</Button>}
    >
      <p lang={strings.lang === 'en' ? 'en' : undefined}>{strings.sessionExpiredBody(savedUpTo)}</p>
      {copySaved ? null : <p lang={strings.lang === 'en' ? 'en' : undefined}>{strings.sessionExpiredNoCopy(savedUpTo)}</p>}
    </Dialog>
  );
}
