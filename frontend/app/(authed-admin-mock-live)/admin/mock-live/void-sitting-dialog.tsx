'use client';

import { useState } from 'react';

import { Dialog } from '@/components/admin-directory-ui';

export function VoidSittingDialog({ studentName, busy, onCancel, onConfirm }: {
  studentName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    const value = reason.trim();
    if (!value) {
      setError('Cần nêu lý do để giữ audit trail cho lượt thi bị huỷ.');
      return;
    }
    setError('');
    await onConfirm(value);
  };

  return <Dialog
    open
    title={`Huỷ lượt thi của ${studentName}?`}
    description="Lượt thi vẫn được giữ trong dữ liệu với trạng thái void và không thể công bố kết quả."
    busy={busy}
    onClose={onCancel}
    panelClassName="mlv-void-dialog"
    actions={<>
      <button type="button" className="adm-btn-secondary" onClick={onCancel} disabled={busy}>Quay lại</button>
      <button type="button" className="adm-btn-danger" onClick={() => void submit()} disabled={busy}>{busy ? 'Đang đối chiếu…' : 'Huỷ lượt thi'}</button>
    </>}
  >
      <div className="mlv-void-body">
        <label htmlFor="mlv-void-reason">Lý do huỷ <span aria-hidden="true">*</span></label>
        <textarea
          id="mlv-void-reason"
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'mlv-void-error' : undefined}
          disabled={busy}
          placeholder="Ví dụ: học viên mở nhầm đề và chưa bắt đầu làm bài"
        />
        {error && <p id="mlv-void-error" className="mlv-field-error" role="alert">{error}</p>}
      </div>
  </Dialog>;
}
