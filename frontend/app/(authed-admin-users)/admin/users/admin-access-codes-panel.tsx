'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { activeAssignmentCount, normalizeCodesPayload, quotaLabel, selectCodes, validateCodeDraft } from '@/lib/admin-users-model.mjs';

import type { AccessCode, AdminCohort, Banner, SortState } from './admin-user-types';
import { CODE_TYPES } from './admin-user-types';
import {
  codeTypeLabel,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  formatDate,
  LoadingState,
  messageOf,
  PermissionsPicker,
  SortButton,
  StatusBanner,
} from './admin-user-ui';

type ConfirmState = null | {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<void>;
};

type CreateDraft = {
  count: string;
  codeType: 'mass' | 'direct' | 'staff';
  cohortId: string;
  permissions: string[];
  sessionLimit: string;
  expiresAt: string;
  notes: string;
  error: string;
};

type EditDraft = {
  code: AccessCode;
  permissions: string[];
  sessionLimit: string;
  error: string;
};

export function AdminAccessCodesPanel({ profileId, cohorts, cohortsError }: {
  profileId: string;
  cohorts: AdminCohort[];
  cohortsError: string | null;
}) {
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [cohort, setCohort] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ field: 'created_at', order: 'desc' });
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [create, setCreate] = useState<CreateDraft | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const sequence = useRef(0);

  const loadCodes = useCallback(async (silent = false) => {
    const requestId = ++sequence.current;
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const payload = normalizeCodesPayload(await window.api.get<unknown>('/admin/access-codes')) as AccessCode[];
      if (requestId !== sequence.current) return false;
      setCodes(payload);
      return true;
    } catch (caught) {
      if (requestId !== sequence.current) return false;
      setLoadError(messageOf(caught));
      return false;
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCodes([]);
    setBanner(null);
    setType('');
    setStatus('');
    setCohort('');
    setSearch('');
    setSort({ field: 'created_at', order: 'desc' });
    void loadCodes();
    return () => { sequence.current += 1; };
  }, [profileId, loadCodes]);

  const rows = useMemo(
    () => selectCodes(codes, { type, status, cohort, search }, sort) as AccessCode[],
    [codes, type, status, cohort, search, sort],
  );
  const stats = useMemo(() => ({
    total: codes.length,
    active: codes.filter((code) => code.is_active && !code.is_revoked).length,
    assigned: codes.filter((code) => code.assigned_user_count > 0).length,
    revoked: codes.filter((code) => code.is_revoked).length,
  }), [codes]);

  const sortBy = (field: string) => setSort((current) => ({
    field,
    order: current.field === field && current.order === 'desc' ? 'asc' : 'desc',
  }));

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    if (mutationBusy) return;
    setMutationBusy(true);
    setBanner(null);
    try {
      await action();
      const reloaded = await loadCodes(true);
      setBanner(reloaded
        ? { kind: 'success', text: success }
        : { kind: 'error', text: `${success} Tuy nhiên chưa tải lại được dữ liệu chuẩn; hãy bấm Tải lại.` });
    } catch (caught) {
      setBanner({ kind: 'error', text: messageOf(caught) });
    } finally {
      setMutationBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm || mutationBusy) return;
    const current = confirm;
    setConfirm(null);
    await current.run();
  };

  const submitCreate = async () => {
    if (!create || mutationBusy) return;
    const validation = validateCodeDraft({
      codeType: create.codeType,
      cohortId: create.cohortId || null,
      permissions: create.permissions,
      sessionLimitRaw: create.sessionLimit.trim(),
      countRaw: create.count,
    });
    if (!validation.ok) {
      setCreate({ ...create, error: validation.error || 'Dữ liệu mã không hợp lệ.' });
      return;
    }
    setMutationBusy(true);
    try {
      const response = await window.api.post<{ created?: number }>('/admin/access-codes/generate', {
        count: validation.count,
        permissions: create.permissions,
        code_type: create.codeType,
        cohort_id: create.cohortId || null,
        notes: create.notes.trim() || null,
        session_limit: validation.sessionLimit,
        expires_at: create.expiresAt ? new Date(create.expiresAt).toISOString() : null,
      });
      const reloaded = await loadCodes(true);
      setCreate(null);
      setBanner(reloaded
        ? { kind: 'success', text: `Đã tạo ${response?.created ?? validation.count} mã mới.` }
        : { kind: 'error', text: 'Đã tạo mã nhưng chưa tải lại được dữ liệu chuẩn.' });
    } catch (caught) {
      setCreate({ ...create, error: messageOf(caught) });
    } finally {
      setMutationBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!edit || mutationBusy) return;
    const validation = validateCodeDraft({
      codeType: edit.code.code_type,
      cohortId: edit.code.cohort_id,
      permissions: edit.permissions,
      sessionLimitRaw: edit.sessionLimit.trim(),
    });
    if (!validation.ok) {
      setEdit({ ...edit, error: validation.error || 'Dữ liệu mã không hợp lệ.' });
      return;
    }
    setMutationBusy(true);
    try {
      await window.api.patch(`/admin/access-codes/${encodeURIComponent(edit.code.id)}`, {
        permissions: edit.permissions,
        session_limit: validation.sessionLimit,
      });
      const reloaded = await loadCodes(true);
      setEdit(null);
      setBanner(reloaded
        ? { kind: 'success', text: `Đã cập nhật quyền cho mã ${edit.code.code}.` }
        : { kind: 'error', text: 'Đã cập nhật quyền nhưng chưa tải lại được dữ liệu chuẩn.' });
    } catch (caught) {
      setEdit({ ...edit, error: messageOf(caught) });
    } finally {
      setMutationBusy(false);
    }
  };

  const resetFilters = () => { setType(''); setStatus(''); setCohort(''); setSearch(''); };

  return (
    <section id="codes-panel" className="au-pane" role="tabpanel" aria-labelledby="codes-tab">
      <div className="au-stat-grid" aria-label="Tổng quan mã kích hoạt">
        <div className="au-stat"><span>Tổng mã</span><strong>{stats.total.toLocaleString('vi-VN')}</strong></div>
        <div className="au-stat"><span>Đang hoạt động</span><strong>{stats.active.toLocaleString('vi-VN')}</strong></div>
        <div className="au-stat"><span>Đã gán người dùng</span><strong>{stats.assigned.toLocaleString('vi-VN')}</strong></div>
        <div className="au-stat"><span>Đã thu hồi</span><strong>{stats.revoked.toLocaleString('vi-VN')}</strong></div>
      </div>

      <StatusBanner banner={banner} />
      {cohortsError && <div className="au-inline-warning" role="alert">Không tải được danh sách lớp: {cohortsError}. Bộ lọc lớp và tạo mã Trực tiếp tạm thời chưa dùng được.</div>}

      <div className="au-toolbar au-toolbar--codes">
        <Field label="Loại mã">
          <select value={type} onChange={(event) => setType(event.target.value)}><option value="">Tất cả</option>{CODE_TYPES.map((item) => <option key={item} value={item}>{codeTypeLabel(item)}</option>)}</select>
        </Field>
        <Field label="Trạng thái">
          <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Đang dùng</option><option value="active">Hoạt động</option><option value="revoked">Đã thu hồi</option></select>
        </Field>
        <Field label="Lớp">
          <select value={cohort} onChange={(event) => setCohort(event.target.value)} disabled={Boolean(cohortsError)}><option value="">Tất cả</option>{cohorts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </Field>
        <Field label="Tìm kiếm">
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mã hoặc email…" />
        </Field>
        <button className="adm-btn-secondary" type="button" onClick={resetFilters} disabled={!type && !status && !cohort && !search}>Xóa lọc</button>
        <button className="adm-btn-secondary" type="button" onClick={() => void loadCodes()} disabled={loading || mutationBusy}>{loading ? 'Đang tải…' : 'Tải lại'}</button>
        <button className="adm-btn-primary" type="button" onClick={() => setCreate({ count: '1', codeType: 'mass', cohortId: '', permissions: ['all'], sessionLimit: '', expiresAt: '', notes: '', error: '' })}>Tạo mã mới</button>
      </div>

      {loadError && <div className="au-inline-error" role="alert">Không tải được mã kích hoạt: {loadError}</div>}
      {loading && !codes.length ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState title="Không có mã phù hợp" detail="Thử đổi bộ lọc hoặc tạo mã mới." />
      ) : (
        <div className="au-table-scroll" data-testid="codes-table-scroll">
          <table className="au-table au-codes-table">
            <thead><tr>
              <th>Mã</th><th>Loại</th><th>Lớp</th><th>Người dùng</th>
              <th><SortButton field="status" sort={sort} onSort={sortBy}>Trạng thái</SortButton></th>
              <th>Giới hạn</th>
              <th><SortButton field="expires_at" sort={sort} onSort={sortBy}>Hết hạn</SortButton></th>
              <th><SortButton field="created_at" sort={sort} onSort={sortBy}>Ngày tạo</SortButton></th>
              <th>Ghi chú</th><th>Thao tác</th>
            </tr></thead>
            <tbody>{rows.map((code) => {
              const activeAssignments = activeAssignmentCount(code);
              return <tr key={code.id}>
              <td><code className="au-code-value">{code.code || '—'}</code></td>
              <td><span className={`adm-chip${code.code_type === 'direct' ? ' is-direct' : ''}`}>{codeTypeLabel(code.code_type)}</span></td>
              <td>{code.cohort_name ? <span className="adm-chip is-direct">{code.cohort_name}</span> : '—'}</td>
              <td>{code.association_lookup_failed ? <span className="au-lookup-failed" role="alert">⚠ lookup failed</span> : code.assigned_users.length ? <div className="au-assigned-list">{code.assigned_users.map((user) => <div key={user.user_id} className="au-assigned-user">
                <span>{user.email || user.name || '(không rõ)'}</span>
                {user.quota && <small>{quotaLabel(user.quota)}</small>}
                {user.is_fallback_used_by && <small className="au-history-label">lịch sử kích hoạt</small>}
                {user.removable && <button type="button" className="au-text-danger" onClick={() => setConfirm({
                  title: 'Gỡ người dùng khỏi mã',
                  body: `Gỡ ${user.email || user.name || 'người dùng này'} khỏi mã ${code.code}? Quyền truy cập bị thu hồi ngay; lịch sử kích hoạt vẫn được giữ.`,
                  confirmLabel: 'Gỡ khỏi mã',
                  danger: true,
                  run: async () => mutate(
                    () => window.api.delete(`/admin/access-codes/${encodeURIComponent(code.id)}/users/${encodeURIComponent(user.user_id)}`),
                    'Đã gỡ người dùng khỏi mã.',
                  ),
                })}>Gỡ</button>}
              </div>)}</div> : <span className="au-muted">Chưa gán</span>}</td>
              <td>{code.is_revoked ? <span className="adm-status-pill is-revoked">Đã thu hồi</span> : !code.is_active ? <span className="adm-status-pill is-inactive">Đã khóa</span> : <span className="adm-status-pill is-active">Hoạt động</span>}</td>
              <td className="au-number">{code.session_limit == null ? '∞' : code.session_limit.toLocaleString('vi-VN')}</td>
              <td>{formatDate(code.expires_at)}</td>
              <td>{formatDate(code.created_at)}</td>
              <td><span className="au-notes">{code.notes || '—'}</span></td>
              <td><div className="au-row-actions">
                <a className="adm-btn-secondary adm-btn-sm" href={`/admin/usage?code_id=${encodeURIComponent(code.id)}`}>Hoạt động</a>
                {!code.is_revoked && code.is_active && <>
                  <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setEdit({ code, permissions: [...code.permissions], sessionLimit: code.session_limit == null ? '' : String(code.session_limit), error: '' })}>Sửa quyền</button>
                  <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setConfirm({
                    title: 'Cấp mã mới',
                    body: `Tạo mã mới sao chép quyền, lớp và giới hạn của ${code.code} cho người dùng hiện tại? Mã cũ được giữ nguyên.`,
                    confirmLabel: 'Cấp mã mới',
                    run: async () => mutate(
                      () => window.api.post(`/admin/access-codes/${encodeURIComponent(code.id)}/refill`, {}),
                      'Đã cấp mã mới.',
                    ),
                  })}>Cấp mã mới</button>
                  <button className="adm-btn-danger adm-btn-sm" type="button" disabled={activeAssignments > 0 || code.association_lookup_failed} title={activeAssignments > 0 ? 'Gỡ tất cả người dùng trước khi thu hồi.' : code.association_lookup_failed ? 'Không thể xác minh người đang dùng mã.' : undefined} onClick={() => setConfirm({
                    title: 'Thu hồi mã',
                    body: `Thu hồi mã ${code.code}? Hành động này không thể khôi phục.`,
                    confirmLabel: 'Thu hồi',
                    danger: true,
                    run: async () => mutate(
                      () => window.api.delete(`/admin/access-codes/${encodeURIComponent(code.id)}`),
                      'Đã thu hồi mã.',
                    ),
                  })}>Thu hồi</button>
                </>}
              </div></td>
            </tr>})}</tbody>
          </table>
        </div>
      )}

      <ConfirmDialog state={confirm} busy={mutationBusy} onClose={() => setConfirm(null)} onConfirm={() => void runConfirm()} />

      <Dialog
        open={Boolean(create)}
        title="Tạo mã kích hoạt"
        description="Mã chưa được gán sẽ ở trạng thái sẵn sàng phát hành."
        busy={mutationBusy}
        wide
        onClose={() => setCreate(null)}
        actions={<>
          <button className="adm-btn-secondary" type="button" onClick={() => setCreate(null)} disabled={mutationBusy}>Hủy</button>
          <button className="adm-btn-primary" type="button" onClick={() => void submitCreate()} disabled={mutationBusy}>{mutationBusy ? 'Đang tạo…' : 'Tạo mã'}</button>
        </>}
      >
        {create && <>
          <div className="au-form-grid">
            <Field label="Số lượng"><input type="number" min="1" max="100" value={create.count} onChange={(event) => setCreate({ ...create, count: event.target.value, error: '' })} /></Field>
            <Field label="Loại mã"><select value={create.codeType} onChange={(event) => setCreate({ ...create, codeType: event.target.value as CreateDraft['codeType'], cohortId: event.target.value === 'direct' ? create.cohortId : '', error: '' })}>{CODE_TYPES.map((item) => <option key={item} value={item}>{codeTypeLabel(item)}</option>)}</select></Field>
          </div>
          {create.codeType === 'direct' && <Field label="Lớp"><select value={create.cohortId} onChange={(event) => setCreate({ ...create, cohortId: event.target.value, error: '' })} disabled={Boolean(cohortsError)}><option value="">Chọn lớp…</option>{cohorts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
          <PermissionsPicker value={create.permissions} onChange={(permissions) => setCreate({ ...create, permissions, error: '' })} />
          <div className="au-form-grid">
            <Field label="Giới hạn sessions" hint="Để trống nếu không giới hạn."><input type="number" min="1" value={create.sessionLimit} onChange={(event) => setCreate({ ...create, sessionLimit: event.target.value, error: '' })} /></Field>
            <Field label="Ngày hết hạn" hint="Để trống nếu không hết hạn."><input type="date" value={create.expiresAt} onChange={(event) => setCreate({ ...create, expiresAt: event.target.value, error: '' })} /></Field>
          </div>
          <Field label="Ghi chú"><textarea rows={3} value={create.notes} onChange={(event) => setCreate({ ...create, notes: event.target.value, error: '' })} placeholder="Ví dụ: Lớp tháng 8" /></Field>
          {create.error && <div className="au-inline-error" role="alert">{create.error}</div>}
        </>}
      </Dialog>

      <Dialog
        open={Boolean(edit)}
        title="Sửa quyền của mã"
        description={edit ? <>Thay đổi áp dụng ngay cho <strong>tất cả người dùng</strong> của mã <code>{edit.code.code}</code>.</> : undefined}
        busy={mutationBusy}
        onClose={() => setEdit(null)}
        actions={<>
          <button className="adm-btn-secondary" type="button" onClick={() => setEdit(null)} disabled={mutationBusy}>Hủy</button>
          <button className="adm-btn-primary" type="button" onClick={() => void submitEdit()} disabled={mutationBusy}>{mutationBusy ? 'Đang lưu…' : 'Lưu quyền'}</button>
        </>}
      >
        {edit && <>
          <PermissionsPicker value={edit.permissions} onChange={(permissions) => setEdit({ ...edit, permissions, error: '' })} />
          <Field label="Giới hạn lượt" hint="Tổng lượt của mã; để trống nếu không giới hạn."><input type="number" min="1" value={edit.sessionLimit} onChange={(event) => setEdit({ ...edit, sessionLimit: event.target.value, error: '' })} /></Field>
          {edit.code.assigned_users.some((user) => user.quota) && <div className="au-quota-box"><strong>Lượt đã dùng</strong>{edit.code.assigned_users.filter((user) => user.quota).map((user) => <span key={user.user_id}>{user.email || user.name}: {quotaLabel(user.quota)}</span>)}</div>}
          {edit.error && <div className="au-inline-error" role="alert">{edit.error}</div>}
        </>}
      </Dialog>
    </section>
  );
}
