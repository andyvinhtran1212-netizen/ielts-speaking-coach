'use client';

// Thẻ Khoá và quyền (ADMINIA-0074 FR-033; G09-T11b): role change with a
// confirm, then the danger zone at the very end. Only existing write routes:
// PATCH /admin/users/{id}/role (step-up through AdminAccessGate) and
// DELETE /admin/cohorts/{id}/students/{student_id}. Every write is followed by
// a canonical reload of the profile.
import { useEffect, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, messageOf } from '@/components/admin-directory-ui';
import { changeUserRole, removeFromCohort, type LearnerDetailWire } from '@/lib/admin-learners-api';
import {
  ROLE_OPTIONS,
  TAB_PENDING,
  removeConfirmText,
  roleChangeBlocked,
  roleConfirmText,
  roleErrorText,
  roleLabel,
  roleResultText,
} from '@/lib/admin-learner-profile-model.mjs';

type Banner = { kind: 'success' | 'error'; text: string };
// Every pick and every open confirm is bound to the profile it was made on:
// the admin, the learner ref, the account and the learner profile id. If the
// profile changes on the same instance (client navigation, or a reload that
// answers another person), the old pick and the old dialog no longer apply.
type Pending =
  | { ctx: string; kind: 'role'; userId: string; from: string | null; to: string; name: string }
  | { ctx: string; kind: 'remove'; studentId: string; cohortId: string; cohortName: string; name: string }
  | null;

/** The identity a pick or a confirm belongs to. */
export function accessContext(adminId: string | null | undefined, learnerRef: string, detail: LearnerDetailWire): string {
  return JSON.stringify([adminId ?? '', learnerRef, detail.canonical_ref ?? detail.ref ?? '', detail.account?.user_id ?? '', detail.student_id ?? '']);
}

export function LearnerAccessTab({ learnerRef, detail, onChanged }: {
  /** The ref the page is on now (it changes before the new profile is read). */
  learnerRef: string;
  detail: LearnerDetailWire;
  /** Shows the result and reloads the canonical profile. */
  onChanged: (banner: Banner | null) => Promise<void> | void;
}) {
  const profile = useAdminProfile();
  const account = detail.account ?? null;
  const name = detail.summary.name;
  const cohorts = Array.isArray(detail.summary.cohorts) ? detail.summary.cohorts : null;
  const blocked = roleChangeBlocked(account, profile.id);
  const currentRole = account?.role === 'user' ? 'student' : (account?.role ?? 'student');
  const ctx = accessContext(profile.id, learnerRef, detail);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  // The tab unmounts while another profile loads; an answer that comes back
  // after that belongs to nobody on screen.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // The pick is kept with the profile and the role it was made against, so a
  // reload that changes the server's role, or another profile, starts the
  // select again from the server's role. Derived in render, not reset in an
  // effect: a late mount effect could otherwise overwrite a pick already made.
  const [choice, setChoice] = useState<{ ctx: string; from: string; to: string } | null>(null);
  const nextRole = choice && choice.ctx === ctx && choice.from === currentRole ? choice.to : currentRole;
  const setNextRole = (to: string) => setChoice({ ctx, from: currentRole, to });
  const [stored, setPending] = useState<Pending>(null);
  // A confirm opened on another profile is not shown and cannot be sent.
  const pending = stored && stored.ctx === ctx ? stored : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Drop them for good on a change of profile, so coming back to the first
  // profile does not bring an old pick or an old dialog back (state adjusted
  // during render, React's pattern for a prop change).
  if (stored && stored.ctx !== ctx) { setPending(null); setError(''); }
  // Also once the server's role moved: a pick made on A is not brought back by a later A -> B -> A.
  if (choice && (choice.ctx !== ctx || choice.from !== currentRole)) setChoice(null);

  const open = (next: NonNullable<Pending>) => { setError(''); setPending(next); };
  const close = () => { if (!busy) { setPending(null); setError(''); } };

  const confirm = async () => {
    const sent = pending;
    if (!sent || sent.ctx !== ctxRef.current) return;
    // The answer belongs to the profile the confirm was opened on; after a
    // change of profile it is dropped (no banner, no error, no reload of the
    // new profile with the old result).
    const current = () => mounted.current && ctxRef.current === sent.ctx;
    setBusy(true);
    setError('');
    try {
      if (sent.kind === 'role') {
        const out = await changeUserRole(sent.userId, sent.to);
        if (!current()) return;
        const result = roleResultText(out, sent.to, sent.userId);
        setPending(null);
        await onChanged(result);
      } else {
        await removeFromCohort(sent.cohortId, sent.studentId);
        if (!current()) return;
        setPending(null);
        await onChanged({ kind: 'success', text: `Đã gỡ ${sent.name} khỏi lớp ${sent.cohortName}.` });
      }
    } catch (caught) {
      if (!current()) return;
      // The dialog stays open with the reason; the profile is reloaded in
      // case a request whose answer was lost still committed.
      setError(sent.kind === 'role' ? roleErrorText(caught) : `Chưa gỡ được khỏi lớp: ${messageOf(caught)}`);
      void onChanged(null);
    } finally {
      setBusy(false);
    }
  };

  const sameRole = currentRole === nextRole;

  return (
    <div className="lp-access">
      <p className="la-note" role="status">Chưa mở phần khoá học. {TAB_PENDING['khoa-va-quyen']}</p>

      <section className="lp-block" aria-labelledby="lp-role">
        <h2 id="lp-role">Vai trò</h2>
        <p>Vai trò hiện tại: <strong>{account ? roleLabel(account.role) : 'Chưa có tài khoản'}</strong></p>
        {blocked ? <p className="la-note">{blocked}</p> : (
          <div className="lp-role-form">
            <label>Vai trò mới{' '}
              <select value={nextRole} onChange={(e) => setNextRole(e.target.value)} disabled={busy}>
                {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <button type="button" className="adm-btn-secondary" disabled={busy || sameRole}
              onClick={() => { if (account) open({ ctx, kind: 'role', userId: account.user_id, from: account.role, to: nextRole, name }); }}>Đổi vai trò</button>
          </div>
        )}
      </section>

      <section className="lp-block lp-danger" aria-labelledby="lp-danger">
        <h2 id="lp-danger">Vùng nguy hiểm</h2>
        <p>Các thao tác dưới đây ảnh hưởng quyền học của {name}. Mỗi thao tác hỏi lại trước khi thực hiện.</p>

        <div className="lp-danger__row">
          <div>
            <strong>Thu hồi quyền học</strong>
            <p className="la-note">Chưa có: cần dữ liệu khoá học (G04).</p>
          </div>
          <button type="button" className="adm-btn-secondary" disabled>Thu hồi quyền học</button>
        </div>

        <div className="lp-danger__row">
          <div>
            <strong>Gỡ khỏi lớp</strong>
            <p>Không nhận bài giao mới, không có trong bảng điểm lớp. Quyền khoá học và lịch sử bài làm giữ nguyên.</p>
            {!detail.student_id ? <p className="la-note">Người này chưa có hồ sơ học viên nên không thuộc lớp nào.</p>
              : cohorts === null ? <p className="la-warning" role="status">Chưa đọc được danh sách lớp; tải lại trang.</p>
                : !cohorts.length ? <p className="la-note">Không thuộc lớp nào.</p> : null}
          </div>
          {detail.student_id && cohorts?.length ? (
            <div className="lp-danger__actions">
              {cohorts.map((c) => {
                const label = c.name || 'Lớp không tên';
                return (
                  <button key={c.id} type="button" className="adm-btn-secondary" disabled={busy}
                    onClick={() => { if (detail.student_id) open({ ctx, kind: 'remove', studentId: detail.student_id, cohortId: c.id, cohortName: label, name }); }}>Gỡ khỏi {label}</button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="lp-danger__row">
          <div>
            <strong>Khoá tài khoản</strong>
            <p className="la-note">Hiện chỉ khoá được tài khoản quản trị viên và giảng viên, ở trang Người dùng.</p>
          </div>
          <button type="button" className="adm-btn-secondary" disabled>Khoá tài khoản</button>
        </div>
      </section>

      <Dialog
        open={pending !== null}
        title={pending?.kind === 'role' ? 'Đổi vai trò?' : 'Gỡ khỏi lớp?'}
        onClose={close}
        busy={busy}
        actions={(
          <>
            <button type="button" className="adm-btn-secondary" disabled={busy} onClick={close}>Huỷ</button>
            <button type="button" className="adm-btn-primary" disabled={busy} onClick={() => void confirm()}>
              {pending?.kind === 'role' ? 'Đổi vai trò' : 'Gỡ khỏi lớp'}
            </button>
          </>
        )}
      >
        <p>
          {pending?.kind === 'role' ? roleConfirmText(pending.name, pending.from, pending.to) : null}
          {pending?.kind === 'remove' ? removeConfirmText(pending.name, pending.cohortName) : null}
        </p>
        {error ? <p className="la-warning" role="alert">{error}</p> : null}
      </Dialog>
    </div>
  );
}
