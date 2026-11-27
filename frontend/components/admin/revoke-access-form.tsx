'use client';

// ADMINIA-0074 FR-046 (G09-T14): revoke one course access from inside a
// profile's danger zone. The admin types the learner's full name exactly and
// gives a reason; the server records the revoke (G04 entitlement_events).
// Step-up, when the server asks for it, is handled by the shared transport.
import { useEffect, useState, type FormEvent } from 'react';
import { Dialog, Field, messageOf } from '@/components/admin-directory-ui';
import { validateRevoke } from '@/lib/admin-practice-grant-model.mjs';
import { postRevoke } from '@/lib/admin-practice-grant-api';

type Props = {
  open: boolean;
  entitlementId: string;
  courseTitle: string;
  learnerName: string;
  onClose: () => void;
  /** Called after the server confirmed the revoke; the caller refetches. */
  onRevoked?: () => void;
};

export function RevokeAccessForm({ open, entitlementId, courseTitle, learnerName, onClose, onRevoked }: Props) {
  const [typedName, setTypedName] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setTypedName(''); setReason(''); setError(null); } }, [open, entitlementId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const check = validateRevoke({ typedName, reason }, learnerName);
    if (!check.ok) { setError(check.error); return; }
    setBusy(true); setError(null);
    try {
      await postRevoke(entitlementId, check.body.reason);
      onRevoked?.();
      onClose();
    } catch (caught) {
      setError(messageOf(caught));
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      title="Thu hồi quyền học"
      description={`${learnerName} sẽ mất quyền vào khoá “${courseTitle}” ngay. Lượt còn lại của quyền này không dùng được nữa.`}
      busy={busy}
      onClose={() => { if (!busy) onClose(); }}
      actions={(
        <>
          <button className="adm-btn-secondary" type="button" disabled={busy} onClick={onClose}>Huỷ</button>
          <button className="adm-btn-danger" type="submit" form="revoke-access-form" disabled={busy}>
            {busy ? 'Đang thu hồi…' : 'Thu hồi quyền'}
          </button>
        </>
      )}
    >
      <form id="revoke-access-form" onSubmit={submit}>
        <Field label={`Gõ đúng họ tên “${learnerName}” để xác nhận`}>
          <input value={typedName} autoComplete="off" onChange={(e) => { setTypedName(e.target.value); setError(null); }} />
        </Field>
        <Field label="Lý do">
          <textarea value={reason} maxLength={500} onChange={(e) => { setReason(e.target.value); setError(null); }} />
        </Field>
        {error ? <p className="acd-banner is-error" role="alert">{error}</p> : null}
      </form>
    </Dialog>
  );
}
