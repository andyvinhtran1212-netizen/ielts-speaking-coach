'use client';

// Thẻ Khoá và quyền (ADMINIA-0074 FR-033; G09-T11b): role change with a
// confirm, then the danger zone at the very end. Only existing write routes:
// PATCH /admin/users/{id}/role (step-up through AdminAccessGate) and
// DELETE /admin/cohorts/{id}/students/{student_id}. Every write is followed by
// a canonical reload of the profile.
import { useEffect, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, messageOf } from '@/components/admin-directory-ui';
import { RevokeAccessForm } from '@/components/admin/revoke-access-form';
import { getUserAccess, revocableEntitlements, type RevocableEntitlement } from '@/lib/admin-learner-entitlements';
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
type Pending =
  | { kind: 'role'; to: string }
  | { kind: 'remove'; cohortId: string; cohortName: string }
  | null;

export function LearnerAccessTab({ detail, onChanged }: {
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
  const [nextRole, setNextRole] = useState(currentRole);
  // After a reload the select starts again from the role the server has.
  useEffect(() => { setNextRole(currentRole); }, [currentRole]);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => { if (!busy) { setPending(null); setError(''); } };

  // G04 course access (FR-046): which entitlements in force can be revoked.
  const userId = account?.user_id ?? null;
  const [entitlements, setEntitlements] = useState<RevocableEntitlement[] | null>(null);
  const [accessError, setAccessError] = useState('');
  const [revoking, setRevoking] = useState<RevocableEntitlement | null>(null);
  const [accessTick, setAccessTick] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    setEntitlements(null); setAccessError('');
    getUserAccess(userId)
      .then((out) => { if (live) setEntitlements(revocableEntitlements(out.items)); })
      .catch((caught) => {
        if (!live) return;
        console.warn('[learner-access] access read failed', caught);
        setAccessError(messageOf(caught));
      });
    return () => { live = false; };
  }, [userId, accessTick]);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      if (pending.kind === 'role' && account) {
        const out = await changeUserRole(account.user_id, pending.to);
        setPending(null);
        await onChanged(roleResultText(out, pending.to));
      } else if (pending.kind === 'remove' && detail.student_id) {
        await removeFromCohort(pending.cohortId, detail.student_id);
        setPending(null);
        await onChanged({ kind: 'success', text: `Đã gỡ ${name} khỏi lớp ${pending.cohortName}.` });
      }
    } catch (caught) {
      // The dialog stays open with the reason; the profile is reloaded in
      // case a request whose answer was lost still committed.
      setError(pending.kind === 'role' ? roleErrorText(caught) : `Chưa gỡ được khỏi lớp: ${messageOf(caught)}`);
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
              onClick={() => setPending({ kind: 'role', to: nextRole })}>Đổi vai trò</button>
          </div>
        )}
      </section>

      <section className="lp-block lp-danger" aria-labelledby="lp-danger">
        <h2 id="lp-danger">Vùng nguy hiểm</h2>
        <p>Các thao tác dưới đây ảnh hưởng quyền học của {name}. Mỗi thao tác hỏi lại trước khi thực hiện.</p>

        <div className="lp-danger__row">
          <div>
            <strong>Thu hồi quyền học</strong>
            <p>Học viên mất quyền vào khoá ngay; lượt còn lại của quyền đó không dùng được nữa. Phải gõ đúng họ tên và ghi lý do.</p>
            {!userId ? <p className="la-note">Người này chưa có tài khoản đăng nhập nên chưa có quyền học để thu hồi.</p>
              : accessError ? (
                <p className="la-warning" role="alert">Chưa đọc được quyền học: {accessError}{' '}
                  <button type="button" className="adm-btn-secondary" onClick={() => setAccessTick((n) => n + 1)}>Tải lại</button>
                </p>
              ) : entitlements === null ? <p className="la-note" role="status">Đang đọc quyền học…</p>
                : !entitlements.length ? <p className="la-note">Không có quyền học nào đang hiệu lực (quyền từ mã lớp cũ không thu hồi ở đây).</p> : null}
          </div>
          {entitlements?.length ? (
            <div className="lp-danger__actions">
              {entitlements.map((e) => (
                <button key={e.entitlementId} type="button" className="adm-btn-secondary" disabled={busy}
                  onClick={() => setRevoking(e)}>Thu hồi {e.title}</button>
              ))}
            </div>
          ) : null}
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
                    onClick={() => setPending({ kind: 'remove', cohortId: c.id, cohortName: label })}>Gỡ khỏi {label}</button>
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

      {revoking ? (
        <RevokeAccessForm
          open
          entitlementId={revoking.entitlementId}
          courseTitle={revoking.title}
          learnerName={name}
          onClose={() => setRevoking(null)}
          onRevoked={async () => {
            setAccessTick((n) => n + 1);
            await onChanged({ kind: 'success', text: `Đã thu hồi quyền khoá ${revoking.title} của ${name}.` });
          }}
        />
      ) : null}

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
          {pending?.kind === 'role' && account ? roleConfirmText(name, account.role, pending.to) : null}
          {pending?.kind === 'remove' ? removeConfirmText(name, pending.cohortName) : null}
        </p>
        {error ? <p className="la-warning" role="alert">{error}</p> : null}
      </Dialog>
    </div>
  );
}
