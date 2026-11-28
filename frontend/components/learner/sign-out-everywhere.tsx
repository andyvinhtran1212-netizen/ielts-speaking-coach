'use client';

// "Đăng xuất khỏi mọi thiết bị" (ENROLL-0060 G05-T20, FR-053; TaiKhoanDangNhap
// screen 5). Everything comes from G04-T09:
//  - `GET /api/account/session/status` decides whether the button exists
//    (`enabled=true` only; 404 = route not there yet, treated as off) and, when
//    the dialog opens, whether another device is inside timed work (5b);
//  - `POST /api/account/sessions/revoke-all` ends every session, this one too,
//    and cancels unused sign-in codes; timed work is not cut (the server signs
//    that device out when it ends). 404 `single_session_disabled` hides the
//    button; any other failure says so and keeps the dialog.
// 5a does not promise that drafts on other devices are kept: no page registers
// a draft saver yet and other devices cannot be reached, so it warns instead.
// In 5c the server says whether timed work deferred a sign-out. "Đăng nhập
// lại" (and closing the dialog) signs out locally and goes to /login.
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { saveAllDrafts } from '@/lib/auth/draft-savers.mjs';
import { minutesLeftText } from '@/lib/auth/session-claim.mjs';
import { clearPersistedAuthSession } from '@/lib/auth/sign-out-state.mjs';
import { getBrowserJson, postBrowserJsonAtWith } from '@/lib/browser-api';
import type { ApiPostJson } from '@/lib/openapi-contract';
import { formatVnDateTime } from '@/lib/profile-v2-model.mjs';

import styles from './sign-out-everywhere.module.css';

const STATUS = '/api/account/session/status';
const REVOKE_ALL = '/api/account/sessions/revoke-all';

type TimedActivity = NonNullable<ApiPostJson<typeof REVOKE_ALL>['deferred_timed']>;
type Step =
  | { kind: 'ask'; timed: TimedActivity | null }
  | { kind: 'done'; at: string | null; deferred: TimedActivity | null };

const statusOf = (error: unknown) => (error && typeof error === 'object' ? (error as { status?: number }).status : undefined);
const codeOf = (error: unknown) => {
  const detail = error && typeof error === 'object' ? (error as { detail?: unknown }).detail : null;
  return detail && typeof detail === 'object' ? (detail as { error_code?: unknown }).error_code : undefined;
};
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function readStatus(): Promise<{ timed: TimedActivity | null } | 'off'> {
  try {
    const raw = await getBrowserJson(STATUS);
    if (!raw || raw.enabled !== true) return 'off';
    return { timed: raw.timed_activity && typeof raw.timed_activity === 'object' ? raw.timed_activity : null };
  } catch (error) {
    // The route not being there (404) is the flag being off. Any other
    // failure keeps the button: revoke-all reports its own error.
    return statusOf(error) === 404 ? 'off' : { timed: null };
  }
}

function TimedWarning({ timed, beforeRevoke = false }: { timed: TimedActivity; beforeRevoke?: boolean }) {
  const title = text(timed.title) ?? 'Bài có giờ';
  const device = text(timed.device_label);
  const left = minutesLeftText(timed.minutes_left);
  const where = device ? `đang làm ở ${device}` : beforeRevoke ? 'đang làm ở thiết bị khác' : 'đang diễn ra';
  const lead = `${title} ${where}${left ? `, ${left}` : ''}.`;
  return (
    <Notice kind="warning" live="none">
      {lead} Bài có giờ không bị cắt ngang: thiết bị đó đăng xuất ngay khi bài kết thúc.
      {beforeRevoke ? ' Các thiết bị khác đăng xuất bây giờ.' : null}
    </Notice>
  );
}

async function signInAgain() {
  try { await (window as any).getSupabase?.()?.auth?.signOut?.({ scope: 'local' }); } catch { /* fail closed below */ }
  clearPersistedAuthSession();
  try { (window as any).api?.clearAuthCache?.(); } catch { /* optional */ }
  window.location.replace('/login');
}

export function SignOutEverywhereDialog({
  open,
  email,
  onClose,
  onUnavailable,
}: {
  open: boolean;
  email: string | null;
  onClose: () => void;
  /** The server says this account has no such action (404 single_session_disabled). */
  onUnavailable?: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'ask', timed: null });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setStep({ kind: 'ask', timed: null });
    setFailed(false);
    void readStatus().then((s) => {
      if (live && s !== 'off') {
        setStep((current) => current.kind === 'ask' ? { ...current, timed: s.timed } : current);
      }
    });
    return () => { live = false; };
  }, [open]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      // Keep this page's drafts first (savers registered on this device).
      // Other devices cannot be reached from here, so 5a warns instead of
      // promising that their unsaved text is kept.
      await saveAllDrafts();
      const raw = await postBrowserJsonAtWith(REVOKE_ALL, REVOKE_ALL);
      if (!raw) throw new Error('Missing revoke-all acknowledgment');
      setStep({ kind: 'done', at: formatVnDateTime(raw.at), deferred: raw.deferred_timed ?? null });
    } catch (error) {
      if (statusOf(error) === 404 && codeOf(error) === 'single_session_disabled') {
        onUnavailable?.();
        onClose();
      } else {
        setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === 'done') {
    const receipt = step.deferred ? 'Đã tiếp nhận yêu cầu đăng xuất' : 'Đã đăng xuất khỏi mọi thiết bị';
    return (
      <Dialog
        open={open}
        onClose={() => void signInAgain()}
        title={step.deferred ? 'Đang chờ bài có giờ kết thúc' : 'Đã đăng xuất khỏi mọi thiết bị'}
        closeLabel="Đăng nhập lại"
        initialFocusRef={againRef}
        actions={<Button ref={againRef} onClick={() => void signInAgain()}>Đăng nhập lại</Button>}
      >
        <div className={styles.body}>
          <p>{step.at ? `${receipt} lúc ${step.at}.` : `${receipt}.`}</p>
          {step.deferred ? <TimedWarning timed={step.deferred} /> : null}
          <p>{email ? `Đăng nhập lại bằng Google hoặc bằng mã gửi tới ${email}.` : 'Đăng nhập lại bằng Google hoặc bằng mã gửi tới email của bạn.'}</p>
          <p className={styles.muted}>
            Nghĩ có người khác mở được hộp thư của bạn? Bảo vệ hộp thư email trước, vì mã đăng nhập gửi về đó; rồi báo cho chúng tôi.
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      role="alertdialog"
      busy={busy}
      title="Đăng xuất khỏi mọi thiết bị?"
      initialFocusRef={cancelRef}
      actions={(
        <>
          <Button variant="danger" loading={busy} loadingLabel="Đang đăng xuất…" onClick={() => void confirm()}>
            Đăng xuất khỏi mọi thiết bị
          </Button>
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onClose}>Huỷ</Button>
        </>
      )}
    >
      <div className={styles.body}>
        <p>
          {email
            ? `Mọi thiết bị đang mở tài khoản ${email}, kể cả thiết bị này, phải đăng nhập lại.`
            : 'Mọi thiết bị đang mở tài khoản này, kể cả thiết bị này, phải đăng nhập lại.'}
        </p>
        <p>Phần bài đang viết dở chưa kịp tự lưu ở các thiết bị đó có thể mất. Lưu bài ở đó trước nếu được.</p>
        <p>Mã đăng nhập đã gửi mà chưa dùng bị huỷ.</p>
        {step.timed ? <TimedWarning timed={step.timed} beforeRevoke /> : null}
        {failed ? <Notice kind="error">Chưa đăng xuất được khỏi mọi thiết bị. Thử lại sau ít phút.</Notice> : null}
      </div>
    </Dialog>
  );
}

/** The Hồ sơ entry: the button only when the server says the rule applies. */
export function SignOutEverywhere({ email }: { email: string | null }) {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void readStatus().then((s) => { if (live) setAvailable(s !== 'off'); });
    return () => { live = false; };
  }, []);

  if (!available) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Đăng xuất khỏi mọi thiết bị</Button>
      <SignOutEverywhereDialog
        open={open}
        email={email}
        onClose={() => setOpen(false)}
        onUnavailable={() => setAvailable(false)}
      />
    </>
  );
}
