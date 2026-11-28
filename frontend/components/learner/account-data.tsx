'use client';

// ACCOUNTDATA-0100 ui-states.md, built by G07-T17 on /account (sheet TaiKhoan):
// - `DataExportBlock`: "Dữ liệu của tôi" (FR-010…FR-012).
// - `DeleteAccountZone`: "Yêu cầu xoá tài khoản và dữ liệu" (FR-001, FR-002).
// - `PendingDeletionNotice`: the notice while a request is pending (FR-003).
// The routes and error codes are #2600's. Every action reads the server
// state again; nothing here guesses a state the server did not return.
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { TextField } from '@/components/ui/text-field';
import {
  downloadPath,
  emailMatches,
  eraseDateText,
  errorCode,
  errorStatus,
  exportTimeText,
  isStaffRole,
  normalizeDeletion,
  normalizeExport,
  retryAtText,
  sizeText,
  type DeletionView,
  type ExportView,
} from '@/lib/account-data-model.mjs';
import { clearPersistedAuthSession } from '@/lib/auth/sign-out-state.mjs';

import styles from './account-data.module.css';

const STAFF_LINE = 'Tài khoản nhân viên không tự xoá được. Bạn liên hệ admin nhé.';

/** The session is already gone on the server: sign out here and go to /login. */
async function signInAgain() {
  try { await (window as any).getSupabase?.()?.auth?.signOut?.({ scope: 'local' }); } catch { /* fail closed below */ }
  clearPersistedAuthSession();
  try { (window as any).api?.clearAuthCache?.(); } catch { /* optional */ }
  window.location.replace('/login');
}

// ── Dữ liệu của tôi ─────────────────────────────────────────────────────────

type ExportState =
  | { kind: 'loading' }
  | { kind: 'absent' }
  | { kind: 'error' }
  | { kind: 'ready'; view: ExportView };

function exportLine(view: ExportView): string {
  switch (view.status) {
    case 'queued':
    case 'building':
      return 'Đang chuẩn bị gói dữ liệu. Khi xong, bạn sẽ nhận email báo quay lại trang này để tải.';
    case 'ready': {
      const size = sizeText(view.sizeBytes);
      const until = exportTimeText(view.expiresAt);
      return `Gói dữ liệu đã sẵn sàng${size ? ` (${size})` : ''}.${until ? ` Tải trước ${until}.` : ''}`;
    }
    case 'expired':
      return 'Gói dữ liệu trước đã hết hạn. Bạn yêu cầu gói mới nhé.';
    case 'failed':
      return 'Tạo gói dữ liệu bị lỗi. Bạn yêu cầu lại nhé.';
    default:
      return 'Bạn có thể tải một bản dữ liệu của mình: hồ sơ, bài làm, phiếu kết quả và lịch sử lượt chấm.';
  }
}

export function DataExportBlock({ onUnavailable }: { onUnavailable?: () => void }) {
  const [state, setState] = useState<ExportState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'warning' | 'error'; text: string } | null>(null);
  const [erasing, setErasing] = useState(false);
  // Set on every setup, cleared on every cleanup, so Strict Mode's
  // setup → cleanup → setup leaves it true for the mounted instance.
  const alive = useRef(false);
  // Each read takes a number; only the latest one may write the state.
  const generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    const current = () => alive.current && ticket === generation.current;
    setState({ kind: 'loading' });
    try {
      const view = normalizeExport(await window.api.getWith<unknown>('/api/account/data-export'));
      if (!current()) return;
      setState(view ? { kind: 'ready', view } : { kind: 'error' });
    } catch (error) {
      if (!current()) return;
      // Routes not deployed: the block goes away, never stuck on "Đang tải".
      if (errorStatus(error) === 404) { setState({ kind: 'absent' }); onUnavailable?.(); return; }
      setState({ kind: 'error' });
    }
  }, [onUnavailable]);

  useEffect(() => { void load(); }, [load]);

  const request = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await window.api.postWith<unknown>('/api/account/data-export', {});
    } catch (error) {
      const code = errorCode(error);
      if (code === 'export_recently_requested') {
        const at = retryAtText(error);
        setMessage({ kind: 'warning', text: `Bạn vừa có một gói tải dữ liệu.${at ? ` Bạn yêu cầu gói mới được từ ${at}.` : ' Bạn yêu cầu gói mới sau ít giờ nữa nhé.'}` });
      } else if (code === 'account_erasing') {
        setErasing(true);
      } else {
        setMessage({ kind: 'error', text: 'Chưa gửi được yêu cầu. Thử lại.' });
      }
    }
    if (!alive.current) return;
    setBusy(false);
    await load();
  };

  const download = async (exportId: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    let target: string | null = null;
    let code: string | null = null;
    try {
      // #2600: `Accept: application/json` returns {url, expires_in_seconds}
      // (a signed Storage URL, 60 s) instead of the 302, so the browser opens
      // the link itself and nothing is pulled through fetch here.
      const reply = await window.api.getWith<{ url?: unknown }>(downloadPath(exportId), { Accept: 'application/json' });
      target = typeof reply?.url === 'string' && /^https:\/\//.test(reply.url) ? reply.url : null;
    } catch (error) {
      code = errorCode(error);
    }
    if (!alive.current) return;
    setBusy(false);
    if (target) {
      window.location.assign(target);
      return;
    }
    if (code === 'export_expired' || code === 'export_not_found') {
      setMessage({ kind: 'warning', text: 'Gói dữ liệu này đã hết hạn hoặc không còn. Bạn yêu cầu gói mới nhé.' });
      await load();
    } else if (code === 'export_not_ready') {
      await load();
    } else {
      setMessage({ kind: 'error', text: 'Chưa tải xuống được. Thử lại.' });
    }
  };

  if (state.kind === 'absent') return null;
  const view = state.kind === 'ready' ? state.view : null;
  const canRequest = view !== null && ['none', 'expired', 'failed', 'cancelled', 'purged'].includes(view.status);
  return (
    <section className={styles.section} aria-labelledby="du-lieu-cua-toi">
      <h2 id="du-lieu-cua-toi" className={styles.sectionTitle}>Dữ liệu của tôi</h2>
      <div aria-live="polite" className={styles.body}>
        {state.kind === 'loading' ? <p className={styles.muted}>Đang tải trạng thái…</p> : null}
        {state.kind === 'error' ? (
          <Notice kind="error" live="none" action={<Button variant="text" onClick={() => void load()}>Thử lại</Button>}>
            Chưa tải được trạng thái gói dữ liệu.
          </Notice>
        ) : null}
        {erasing ? <p className={styles.muted}>Tài khoản đang được xoá, không tạo gói tải được nữa.</p> : null}
        {view && !erasing ? <p className={styles.text}>{exportLine(view)}</p> : null}
        {message ? <Notice kind={message.kind} live="none">{message.text}</Notice> : null}
      </div>
      {!erasing ? (
        <div className={styles.actions}>
          {state.kind === 'loading' ? <Button variant="secondary" disabled>Yêu cầu tải dữ liệu</Button> : null}
          {canRequest ? (
            <Button variant="secondary" onClick={request} loading={busy} loadingLabel="Đang gửi…">
              {view?.status === 'failed' ? 'Yêu cầu lại' : 'Yêu cầu tải dữ liệu'}
            </Button>
          ) : null}
          {view && (view.status === 'queued' || view.status === 'building') ? (
            <Button variant="secondary" onClick={() => void load()}>Kiểm tra lại</Button>
          ) : null}
          {view?.status === 'ready' && view.exportId ? (
            <Button variant="primary" onClick={() => void download(view.exportId as string)} loading={busy} loadingLabel="Đang mở…">
              Tải xuống
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ── Vùng nguy hiểm ──────────────────────────────────────────────────────────

type Sent = { eraseAfter: string | null; sessionsRevoked: boolean | null; emailSent: boolean | null };

export function DeleteAccountZone({ email, role }: { email: string | null; role: string | null }) {
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [staff, setStaff] = useState(isStaffRole(role));
  const [sent, setSent] = useState<Sent | null>(null);
  useEffect(() => { if (isStaffRole(role)) setStaff(true); }, [role]);

  const matches = emailMatches(typed, email);

  const submit = async () => {
    if (busy || !matches) return;
    setBusy(true);
    setFieldError(null);
    setFailure(null);
    try {
      const raw: any = await window.api.postWith<unknown>('/api/account/deletion-request', { confirm_email: typed.trim() });
      const view = normalizeDeletion(raw);
      setSent({
        eraseAfter: view?.eraseAfter ?? null,
        sessionsRevoked: typeof raw?.sessions_revoked === 'boolean' ? raw.sessions_revoked : null,
        emailSent: typeof raw?.email_sent === 'boolean' ? raw.email_sent : null,
      });
    } catch (error) {
      const code = errorCode(error);
      if (code === 'confirm_email_mismatch') {
        setFieldError('Email bạn gõ không khớp email đăng nhập.');
        document.getElementById(inputId)?.focus();
      } else if (code === 'staff_account_not_self_deletable') {
        setStaff(true);
      } else if (code === 'deletion_in_progress') {
        setFailure('Tài khoản đang được xoá.');
      } else {
        setFailure('Chưa gửi được yêu cầu. Thử lại.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.danger} aria-labelledby="xoa-tai-khoan">
      <h2 id="xoa-tai-khoan" className={styles.sectionTitle}>Yêu cầu xoá tài khoản và dữ liệu</h2>
      {staff ? <p className={styles.text}>{STAFF_LINE}</p> : sent ? (
        <div className={styles.body}>
          <Notice kind="success" live="status" title="Đã gửi yêu cầu xoá.">
            {eraseDateText(sent.eraseAfter) ? `Tài khoản và dữ liệu sẽ bị xoá ngày ${eraseDateText(sent.eraseAfter)}.` : null}
          </Notice>
          <p className={styles.text}>
            {sent.sessionsRevoked === true
              ? 'Bạn đã được đăng xuất khỏi mọi thiết bị.'
              : sent.sessionsRevoked === false
                ? 'Các thiết bị khác sẽ bị đăng xuất trong ít phút.'
                : 'Chưa xác nhận được việc đăng xuất khỏi các thiết bị.'}
            {' '}Trước ngày xoá, bạn đăng nhập lại để huỷ yêu cầu được.
          </p>
          {sent.emailSent === false ? (
            <p className={styles.muted}>Chưa gửi được thư xác nhận. Ngày xoá là ngày ghi ở trên.</p>
          ) : null}
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void signInAgain()}>Đăng nhập lại</Button>
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          <Notice kind="warning" live="none">
            Sau khi gửi, bạn bị đăng xuất khỏi mọi thiết bị. Hết hạn huỷ, tài khoản và mọi dữ liệu học bị xoá hẳn, không khôi phục được. Trong hạn huỷ, bạn đăng nhập lại để huỷ.
          </Notice>
          <TextField
            id={inputId}
            label={email ? `Gõ email đăng nhập (${email}) để xác nhận` : 'Gõ email đăng nhập để xác nhận'}
            type="email"
            autoComplete="off"
            value={typed}
            error={fieldError ?? undefined}
            onChange={(value) => { setTyped(value); setFieldError(null); }}
          />
          {failure ? <Notice kind="error" live="alert">{failure}</Notice> : null}
          <div className={styles.actions}>
            <Button variant="danger" onClick={submit} disabled={!matches} loading={busy} loadingLabel="Đang gửi…">
              Gửi yêu cầu xoá
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Thông báo trong hạn huỷ ─────────────────────────────────────────────────

export function PendingDeletionNotice({ view, onCancelled, onErasing }: {
  view: DeletionView;
  onCancelled: () => void;
  onErasing: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { box.current?.focus(); }, []);

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await window.api.postWith<unknown>('/api/account/deletion-request/cancel', {});
      onCancelled();
      return;
    } catch (error) {
      const code = errorCode(error);
      if (code === 'deletion_in_progress') onErasing();
      else if (code === 'no_pending_deletion_request') { onCancelled(); return; }
      else setFailure('Chưa huỷ được yêu cầu xoá. Thử lại.');
    }
    setBusy(false);
  };

  const date = eraseDateText(view.eraseAfter);
  return (
    <div ref={box} tabIndex={-1} className={styles.pending}>
      {view.status === 'erasing' ? (
        <Notice kind="warning" live="none" title="Tài khoản đang được xoá.">
          Yêu cầu không huỷ được nữa.
        </Notice>
      ) : (
        <Notice
          kind="warning"
          live="none"
          title={date ? `Tài khoản sẽ bị xoá ngày ${date}.` : 'Tài khoản đang chờ xoá.'}
          action={<Button variant="secondary" onClick={cancel} loading={busy} loadingLabel="Đang huỷ…">Huỷ yêu cầu xoá</Button>}
        >
          Trong lúc chờ, bạn chỉ tải được dữ liệu của mình. Huỷ yêu cầu thì học tiếp bình thường.
        </Notice>
      )}
      {failure ? <Notice kind="error" live="alert">{failure}</Notice> : null}
    </div>
  );
}
