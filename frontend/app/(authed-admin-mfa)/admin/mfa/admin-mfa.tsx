'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Dialog } from '@/components/admin-directory-ui';
import { getAdminMfaStatus, type AdminMfaStatusWire } from '@/lib/admin-mfa-api';
import {
  ADMIN_MFA_COPY,
  MFA_RATE_LIMIT_WAIT_MS,
  abandonedTotpFactors,
  adminMfaMode,
  formatFactorDate,
  isCompleteTotpCode,
  isInactiveError,
  mfaErrorKind,
  nextFactorName,
  normalizeTotpCode,
  sanitizeAdminNext,
  verifiedTotpFactors,
} from '@/lib/admin-mfa-model.mjs';
import { getAuthorizationIdentity } from '@/lib/auth-api';
import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

// Supabase Auth MFA surface used here (supabase-js 2.x). The client is the
// shared one owned by the runtime boundary (window.getSupabase()); this page
// never creates its own.
type AuthFailure = { name?: string; message?: string; status?: number; code?: string };
type Result<T> = { data: T | null; error: AuthFailure | null };
type Factor = { id: string; factor_type: string; status: string; friendly_name?: string | null; created_at?: string };
type Enrolled = { id: string; totp: { qr_code: string; secret: string } };
type MfaApi = {
  listFactors(): Promise<Result<{ all: Factor[] }>>;
  enroll(params: { factorType: 'totp'; friendlyName: string }): Promise<Result<Enrolled>>;
  challenge(params: { factorId: string }): Promise<Result<{ id: string }>>;
  verify(params: { factorId: string; challengeId: string; code: string }): Promise<Result<unknown>>;
  unenroll(params: { factorId: string }): Promise<Result<unknown>>;
};

type Boot =
  | { phase: 'loading' }
  | { phase: 'denied'; inactive: boolean }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; status: AdminMfaStatusWire; factors: Factor[] };

type Notice = { kind: 'success' | 'warn' | 'error'; text: string } | null;

function mfaClient(): MfaApi | null {
  const sb = (typeof window.getSupabase === 'function' ? window.getSupabase() : null) as { auth?: { mfa?: MfaApi } } | null;
  return sb?.auth?.mfa ?? null;
}

function failureOf(caught: unknown): AuthFailure {
  return caught && typeof caught === 'object' ? caught as AuthFailure : { message: String(caught) };
}

async function readFactors(mfa: MfaApi): Promise<Factor[]> {
  const { data, error } = await mfa.listFactors();
  if (error || !data || !Array.isArray(data.all)) throw error || new Error('Danh sách yếu tố không đúng định dạng.');
  return data.all;
}

/** challenge + verify; resolves to the GoTrue failure or null. */
async function verifyCode(mfa: MfaApi, factorId: string, code: string): Promise<AuthFailure | null> {
  const challenge = await mfa.challenge({ factorId });
  if (challenge.error || !challenge.data?.id) return challenge.error || { message: 'Không tạo được thử thách xác thực.' };
  const verified = await mfa.verify({ factorId, challengeId: challenge.data.id, code });
  return verified.error;
}

function nextTarget() {
  return sanitizeAdminNext(new URLSearchParams(window.location.search).get('next'));
}

function TotpForm({ id, label, submitLabel, onVerify, onNeedsAal2, autoFocus = false }: {
  id: string;
  label: string;
  submitLabel: string;
  onVerify: (code: string) => Promise<AuthFailure | null>;
  onNeedsAal2?: () => void;
  autoFocus?: boolean;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ kind: string; text: string } | null>(null);
  const [locked, setLocked] = useState(false);
  const [refocus, setRefocus] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (refocus) inputRef.current?.focus(); }, [refocus]);
  useEffect(() => {
    if (!locked) return;
    const timer = window.setTimeout(() => setLocked(false), MFA_RATE_LIMIT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [locked]);

  const submit = async () => {
    if (busy || locked || !isCompleteTotpCode(code)) return;
    setBusy(true);
    setFailure(null);
    let result: AuthFailure | null;
    try { result = await onVerify(code); } catch (caught) { result = failureOf(caught); }
    setBusy(false);
    if (!result) return;
    const kind = mfaErrorKind(result);
    if (kind === 'needs_aal2' && onNeedsAal2) { onNeedsAal2(); return; }
    if (kind === 'wrong_code') {
      setCode('');
      setFailure({ kind, text: ADMIN_MFA_COPY.wrongCode });
      setRefocus((n) => n + 1);
    } else if (kind === 'rate_limited') {
      setLocked(true);
      setFailure({ kind, text: ADMIN_MFA_COPY.rateLimited });
    } else if (kind === 'network') {
      setFailure({ kind, text: ADMIN_MFA_COPY.network });
    } else {
      setFailure({ kind, text: result.message || 'Không xác thực được — thử lại.' });
    }
  };

  return (
    <form className="amfa-code" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor={id}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        name="totp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        disabled={busy}
        autoFocus={autoFocus}
        onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
      />
      <div className="amfa-code__actions">
        <button type="submit" className="adm-btn-primary" disabled={busy || locked || !isCompleteTotpCode(code)}>
          {busy ? 'Đang xác thực…' : submitLabel}
        </button>
        {failure?.kind === 'network' && (
          <button type="button" className="adm-btn-secondary" onClick={() => void submit()} disabled={busy}>Thử lại</button>
        )}
      </div>
      <p className="amfa-error" role="alert" aria-live="assertive">{failure?.text ?? ''}</p>
    </form>
  );
}

function EnrollPanel({ mfa, factors, backup, onEnrolled }: {
  mfa: MfaApi;
  factors: Factor[];
  backup: boolean;
  onEnrolled: () => void;
}) {
  const [enrolled, setEnrolled] = useState<Enrolled | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setBusy(true);
    setFailure('');
    try {
      // An abandoned unverified factor is removed first so it cannot pile up.
      const abandoned = abandonedTotpFactors(factors);
      for (const factor of abandoned) {
        const { error } = await mfa.unenroll({ factorId: factor.id });
        if (error) throw error;
      }
      const remaining = factors.filter((factor) => !abandoned.includes(factor));
      const { data, error } = await mfa.enroll({
        factorType: 'totp',
        friendlyName: nextFactorName(backup ? 'Dự phòng' : 'Ứng dụng xác thực', remaining),
      });
      if (error || !data?.id || !data.totp?.qr_code || !data.totp?.secret) throw error || new Error('Không nhận được mã QR.');
      setEnrolled(data);
    } catch (caught) {
      const failureValue = failureOf(caught);
      const kind = mfaErrorKind(failureValue);
      setFailure(kind === 'rate_limited' ? ADMIN_MFA_COPY.rateLimited
        : kind === 'network' ? ADMIN_MFA_COPY.network
          : failureValue.message || 'Không bắt đầu được thiết lập.');
    } finally {
      setBusy(false);
    }
  };

  if (!enrolled) {
    return (
      <section className="amfa-card" aria-labelledby="amfa-enroll-title">
        <h2 id="amfa-enroll-title">{backup ? 'Thêm yếu tố dự phòng' : 'Thiết lập xác thực 2 bước'}</h2>
        <p>
          Xác thực 2 bước yêu cầu thêm một mã 6 số từ ứng dụng xác thực (Google Authenticator,
          1Password, Authy…) mỗi khi bạn dùng quyền admin. Mất mật khẩu thôi thì chưa đủ để
          người khác vào được khu vực quản trị.
        </p>
        {backup && <p>Lưu yếu tố dự phòng trên một thiết bị khác hoặc ngoại tuyến, để dùng khi mất điện thoại chính.</p>}
        <button type="button" className="adm-btn-primary" onClick={() => void start()} disabled={busy} autoFocus>
          {busy ? 'Đang tạo mã QR…' : 'Bắt đầu thiết lập'}
        </button>
        <p className="amfa-error" role="alert" aria-live="assertive">{failure}</p>
      </section>
    );
  }

  return (
    <section className="amfa-card" aria-labelledby="amfa-scan-title">
      <h2 id="amfa-scan-title">Quét mã QR</h2>
      <ol className="amfa-steps">
        <li>Mở ứng dụng xác thực và quét mã QR bên dưới.</li>
        <li>Không quét được? Nhập khóa bí mật bằng tay.</li>
        <li>Nhập mã 6 số mà ứng dụng hiển thị.</li>
      </ol>
      {/* GoTrue returns the QR as an SVG data URL; no QR library is needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="amfa-qr" src={enrolled.totp.qr_code} alt={ADMIN_MFA_COPY.qrAlt} width={192} height={192} />
      <div className="amfa-secret">
        <span id="amfa-secret-label">Khóa bí mật</span>
        <code aria-labelledby="amfa-secret-label">{enrolled.totp.secret}</code>
        <button
          type="button"
          className="adm-btn-secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(enrolled.totp.secret).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? 'Đã sao chép' : 'Sao chép'}
        </button>
      </div>
      <TotpForm
        id="amfa-enroll-code"
        label="Mã 6 số từ ứng dụng"
        submitLabel="Xác nhận"
        onVerify={async (code) => {
          const failureValue = await verifyCode(mfa, enrolled.id, code);
          if (!failureValue) onEnrolled();
          return failureValue;
        }}
      />
    </section>
  );
}

function ChallengePanel({ mfa, factors, onVerified }: { mfa: MfaApi; factors: Factor[]; onVerified: () => void }) {
  const verified = verifiedTotpFactors(factors) as Factor[];
  const [factorId, setFactorId] = useState(verified[0]?.id ?? '');
  return (
    <section className="amfa-card" aria-labelledby="amfa-challenge-title">
      <h2 id="amfa-challenge-title">Nhập mã xác thực</h2>
      <p>Phiên đăng nhập này cần thêm mã 6 số từ ứng dụng xác thực trước khi dùng quyền admin.</p>
      {verified.length > 1 && (
        <label className="amfa-select">
          <span>Yếu tố xác thực</span>
          <select value={factorId} onChange={(event) => setFactorId(event.target.value)}>
            {verified.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendly_name || 'Ứng dụng xác thực'}</option>)}
          </select>
        </label>
      )}
      <TotpForm
        id="amfa-challenge-code"
        label="Mã 6 số"
        submitLabel="Xác thực"
        autoFocus
        onVerify={async (code) => {
          const failureValue = await verifyCode(mfa, factorId, code);
          if (!failureValue) onVerified();
          return failureValue;
        }}
      />
    </section>
  );
}

function ManagePanel({ mfa, initialFactors, onNeedsAal2 }: {
  mfa: MfaApi;
  initialFactors: Factor[];
  onNeedsAal2: () => void;
}) {
  const [factors, setFactors] = useState<Factor[]>(initialFactors);
  const [listFailed, setListFailed] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Factor | null>(null);
  const [verifyWith, setVerifyWith] = useState('');
  const [notice, setNotice] = useState<Notice>(null);

  // Every change refetches the canonical list from Supabase Auth.
  const refetch = useCallback(async () => {
    setListBusy(true);
    try {
      const next = await readFactors(mfa);
      setFactors(next);
      setListFailed(false);
      return next;
    } catch {
      setListFailed(true);
      return null;
    } finally {
      setListBusy(false);
    }
  }, [mfa]);

  const verified = verifiedTotpFactors(factors) as Factor[];

  if (adding) {
    return (
      <>
        <EnrollPanel
          mfa={mfa}
          factors={factors}
          backup={verified.length > 0}
          onEnrolled={() => {
            setAdding(false);
            setNotice({ kind: 'success', text: verified.length > 0 ? 'Đã thêm yếu tố dự phòng.' : ADMIN_MFA_COPY.enrolled });
            void refetch();
          }}
        />
        <button type="button" className="adm-btn-secondary amfa-cancel" onClick={() => setAdding(false)}>Hủy</button>
      </>
    );
  }

  return (
    <section className="amfa-card" aria-labelledby="amfa-manage-title">
      <h2 id="amfa-manage-title">Yếu tố xác thực</h2>
      {notice && <div className={`amfa-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      {listFailed ? (
        <div className="amfa-notice is-error" role="alert">
          <span>{ADMIN_MFA_COPY.listFailed}</span>
          <button type="button" className="adm-btn-secondary" onClick={() => void refetch()} disabled={listBusy}>Thử lại</button>
        </div>
      ) : listBusy && !factors.length ? (
        <p role="status">Đang tải danh sách…</p>
      ) : !factors.length ? (
        <p>Chưa có yếu tố xác thực nào.</p>
      ) : (
        <ul className="amfa-factors" aria-busy={listBusy}>
          {factors.map((factor) => (
            <li key={factor.id} className="amfa-factor">
              <div>
                <strong>{factor.friendly_name || 'Ứng dụng xác thực'}</strong>
                <span>Tạo ngày {formatFactorDate(factor.created_at)} · {factor.status === 'verified' ? 'Đã xác minh' : 'Chưa hoàn tất'}</span>
              </div>
              <button
                type="button"
                className="adm-btn-danger"
                onClick={() => {
                  setNotice(null);
                  setVerifyWith(factor.status === 'verified' ? factor.id : verified[0]?.id ?? '');
                  setRemoving(factor);
                }}
              >
                Gỡ
              </button>
            </li>
          ))}
        </ul>
      )}
      {!listFailed && verified.length === 1 && (
        <div className="amfa-notice is-warn" role="status">{ADMIN_MFA_COPY.backupWarning}</div>
      )}
      <button type="button" className="adm-btn-secondary" onClick={() => { setNotice(null); setAdding(true); }} disabled={listFailed}>
        {verified.length > 0 ? 'Thêm yếu tố dự phòng' : 'Thêm yếu tố xác thực'}
      </button>
      <Dialog
        open={Boolean(removing)}
        title="Gỡ yếu tố xác thực"
        description={`Nhập một mã 6 số mới để xác nhận gỡ “${removing?.friendly_name || 'Ứng dụng xác thực'}”.`}
        onClose={() => setRemoving(null)}
        actions={<button type="button" className="adm-btn-secondary" onClick={() => setRemoving(null)}>Hủy</button>}
      >
        {verified.length > 1 && (
          <label className="amfa-select">
            <span>Lấy mã từ</span>
            <select value={verifyWith} onChange={(event) => setVerifyWith(event.target.value)}>
              {verified.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendly_name || 'Ứng dụng xác thực'}</option>)}
            </select>
          </label>
        )}
        {removing && (
          <TotpForm
            id="amfa-remove-code"
            label="Mã 6 số"
            submitLabel="Gỡ yếu tố"
            autoFocus
            onNeedsAal2={() => { setRemoving(null); onNeedsAal2(); }}
            onVerify={async (code) => {
              const failureValue = await verifyCode(mfa, verifyWith, code);
              if (failureValue) return failureValue;
              const { error } = await mfa.unenroll({ factorId: removing.id });
              if (error) return error;
              setRemoving(null);
              const next = await refetch();
              setNotice(next && verifiedTotpFactors(next).length === 0
                ? { kind: 'warn', text: ADMIN_MFA_COPY.lastFactorRemoved }
                : { kind: 'success', text: 'Đã gỡ yếu tố xác thực.' });
              return null;
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

/**
 * /admin/mfa (ADMINAAL2-0032 FR-012, ui-states.md). The backend status owns
 * the session assurance; Supabase Auth owns the factors. Nothing is cached:
 * every load and every change reads both again.
 */
export function AdminMfa() {
  const { status, user } = useAuth();
  const accountKey = status === 'signed-in' && user?.id ? user.id : '';
  const [boot, setBoot] = useState<{ key: string; value: Boot }>({ key: '', value: { phase: 'loading' } });
  const [reload, setReload] = useState(0);
  const [done, setDone] = useState('');
  const [reauth, setReauth] = useState(false);

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  useEffect(() => {
    if (!accountKey) return;
    let dead = false;
    const settle = (value: Boot) => { if (!dead) setBoot({ key: accountKey, value }); };
    settle({ phase: 'loading' });
    (async () => {
      const ready = await whenGlobalReady(
        () => typeof window.api?.get === 'function' && Boolean(mfaClient()),
        'window.api + Supabase (admin MFA)',
      );
      if (dead) return;
      if (!ready) return settle({ phase: 'error', message: 'Không tải được công cụ xác thực. Vui lòng tải lại trang.' });
      try {
        const identity = await getAuthorizationIdentity();
        if (identity.role !== 'admin' || identity.is_active === false) {
          return settle({ phase: 'denied', inactive: identity.role === 'admin' });
        }
        const assurance = await getAdminMfaStatus();
        const factors = await readFactors(mfaClient() as MfaApi);
        settle({ phase: 'ready', status: assurance, factors });
      } catch (caught) {
        if (isInactiveError(caught)) return settle({ phase: 'denied', inactive: true });
        if ((caught as { status?: number } | null)?.status === 403) return settle({ phase: 'denied', inactive: false });
        // A malformed payload keeps its own message; only a transport failure
        // is reported as a connection problem.
        const offline = caught instanceof TypeError || mfaErrorKind(failureOf(caught)) === 'network';
        settle({ phase: 'error', message: !offline && caught instanceof Error && caught.message ? caught.message : ADMIN_MFA_COPY.network });
      }
    })();
    return () => { dead = true; };
  }, [accountKey, reload]);

  const finish = (text: string) => {
    setDone(text);
    window.location.replace(nextTarget());
  };

  const value = accountKey && boot.key === accountKey ? boot.value : { phase: 'loading' } as Boot;

  let body;
  if (value.phase === 'loading') {
    body = <p className="amfa-state" role="status">{ADMIN_MFA_COPY.checking}</p>;
  } else if (value.phase === 'denied') {
    body = (
      <div id="state-denied" className="adm-access-state" role="alert">
        <h2 className="adm-access-state__title">🔒 Admin Access Required</h2>
        {value.inactive && <p className="adm-access-state__message">{ADMIN_MFA_COPY.inactive}</p>}
        <Link href="/home" className="adm-access-state__action">← Quay lại trang chủ</Link>
      </div>
    );
  } else if (value.phase === 'error') {
    body = (
      <div className="amfa-card" role="alert">
        <p className="amfa-error">{value.message}</p>
        <button type="button" className="adm-btn-primary" onClick={() => setReload((n) => n + 1)}>Thử lại</button>
      </div>
    );
  } else if (done) {
    body = <p className="amfa-state amfa-state--done" role="status">{done}</p>;
  } else {
    const mfa = mfaClient() as MfaApi;
    // GoTrue refused a removal for an AAL1 session: challenge first (when a
    // verified factor is left to challenge with).
    const mode = reauth && verifiedTotpFactors(value.factors).length
      ? 'challenge'
      : adminMfaMode(value.status, value.factors);
    body = (
      <>
        {reauth && <div className="amfa-notice is-warn" role="alert">{ADMIN_MFA_COPY.needsAal2}</div>}
        {mode === 'enroll' && (
          <EnrollPanel mfa={mfa} factors={value.factors} backup={false} onEnrolled={() => finish(ADMIN_MFA_COPY.enrolled)} />
        )}
        {mode === 'challenge' && (
          <ChallengePanel mfa={mfa} factors={value.factors} onVerified={() => finish('Đã xác thực 2 bước')} />
        )}
        {mode === 'manage' && (
          <ManagePanel mfa={mfa} initialFactors={value.factors} onNeedsAal2={() => { setReauth(true); setReload((n) => n + 1); }} />
        )}
      </>
    );
  }

  return (
    <main className="amfa-shell">
      <header className="amfa-header">
        <h1>Xác thực 2 bước</h1>
        <p className="subtitle">Quyền admin cần thêm một mã từ ứng dụng xác thực.</p>
      </header>
      {body}
    </main>
  );
}
