'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { normalizeUsersPayload, selectUsers, validateCodeDraft } from '@/lib/admin-users-model.mjs';

import type { AdminCohort, AdminUser, Banner, SortState } from './admin-user-types';
import { CODE_TYPES, ROLES } from './admin-user-types';
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

type ConvertDraft = { user: AdminUser; studentCode: string; fullName: string; error: string };
type GenerateDraft = {
  user: AdminUser;
  codeType: 'mass' | 'direct' | 'staff';
  cohortId: string;
  permissions: string[];
  sessionLimit: string;
  expiresAt: string;
  error: string;
};

export function AdminUsersPanel({ profileId, cohorts, cohortsError }: {
  profileId: string;
  cohorts: AdminCohort[];
  cohortsError: string | null;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ field: 'created_at', order: 'desc' });
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [convert, setConvert] = useState<ConvertDraft | null>(null);
  const [generate, setGenerate] = useState<GenerateDraft | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const sequence = useRef(0);

  const loadUsers = useCallback(async (silent = false) => {
    const requestId = ++sequence.current;
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const payload = normalizeUsersPayload(await window.api.get<unknown>('/admin/users')) as AdminUser[];
      if (requestId !== sequence.current) return false;
      setUsers(payload);
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
    setUsers([]);
    setBanner(null);
    setRole('');
    setSearch('');
    setSort({ field: 'created_at', order: 'desc' });
    void loadUsers();
    return () => { sequence.current += 1; };
  }, [profileId, loadUsers]);

  const rows = useMemo(
    () => selectUsers(users, { role, search }, sort) as AdminUser[],
    [users, role, search, sort],
  );
  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((user) => user.is_active).length,
    staff: users.filter((user) => user.role !== 'student').length,
    coded: users.filter((user) => user.code_summary.has_active_code).length,
  }), [users]);

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
      const reloaded = await loadUsers(true);
      setBanner(reloaded
        ? { kind: 'success', text: success }
        : { kind: 'error', text: `${success} Tuy nhiên chưa tải lại được dữ liệu chuẩn; hãy bấm Tải lại.` });
    } catch (caught) {
      setBanner({ kind: 'error', text: messageOf(caught) });
    } finally {
      setMutationBusy(false);
    }
  };

  const askRoleChange = (user: AdminUser, nextRole: string) => {
    if (nextRole === user.role) return;
    setConfirm({
      title: 'Xác nhận đổi vai trò',
      body: user.id === profileId && nextRole !== 'admin'
        ? 'Bạn không thể tự hạ quyền admin của chính mình.'
        : `Đổi ${user.email || user.display_name || 'người dùng này'} từ ${user.role} sang ${nextRole}?`,
      confirmLabel: 'Đổi vai trò',
      danger: user.id === profileId && nextRole !== 'admin',
      run: user.id === profileId && nextRole !== 'admin'
        ? async () => { throw new Error('Không thể tự hạ quyền admin của chính mình.'); }
        : async () => mutate(
          () => window.api.patch(`/admin/users/${encodeURIComponent(user.id)}/role`, { role: nextRole }),
          `Đã cập nhật vai trò thành ${nextRole}.`,
        ),
    });
  };

  const submitConvert = async () => {
    if (!convert || mutationBusy) return;
    const studentCode = convert.studentCode.trim();
    const fullName = convert.fullName.trim();
    if (!studentCode || !fullName) {
      setConvert({ ...convert, error: 'Mã học viên và họ tên là bắt buộc.' });
      return;
    }
    setMutationBusy(true);
    try {
      await window.api.post('/admin/students', {
        user_id: convert.user.id,
        student_code: studentCode,
        full_name: fullName,
      });
      setConvert(null);
      setBanner({ kind: 'success', text: `Đã tạo hồ sơ học viên cho ${fullName}.` });
    } catch (caught) {
      const message = messageOf(caught);
      setConvert({ ...convert, error: /409|đã là học viên/i.test(message) ? 'Người dùng này đã là học viên.' : message });
    } finally {
      setMutationBusy(false);
    }
  };

  const submitGenerate = async () => {
    if (!generate || mutationBusy) return;
    const validation = validateCodeDraft({
      codeType: generate.codeType,
      cohortId: generate.cohortId || null,
      permissions: generate.permissions,
      sessionLimitRaw: generate.sessionLimit.trim(),
    });
    if (!validation.ok) {
      setGenerate({ ...generate, error: validation.error || 'Dữ liệu mã không hợp lệ.' });
      return;
    }
    setMutationBusy(true);
    try {
      const response = await window.api.post<{ code?: string }>('/admin/access-codes/generate-and-assign', {
        user_id: generate.user.id,
        permissions: generate.permissions,
        code_type: generate.codeType,
        cohort_id: generate.cohortId || null,
        session_limit: validation.sessionLimit,
        expires_at: generate.expiresAt ? new Date(generate.expiresAt).toISOString() : null,
      });
      const reloaded = await loadUsers(true);
      setGenerate(null);
      setBanner(reloaded
        ? { kind: 'success', text: `Đã tạo và gán mã ${response?.code || ''} cho người dùng.` }
        : { kind: 'error', text: 'Đã tạo và gán mã nhưng chưa tải lại được dữ liệu chuẩn.' });
    } catch (caught) {
      setGenerate({ ...generate, error: messageOf(caught) });
    } finally {
      setMutationBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm || mutationBusy) return;
    const current = confirm;
    setConfirm(null);
    try {
      await current.run();
    } catch (caught) {
      setBanner({ kind: 'error', text: messageOf(caught) });
    }
  };

  return (
    <section id="users-panel" className="au-pane" role="tabpanel" aria-labelledby="users-tab">
      <div className="au-stat-grid" aria-label="Tổng quan người dùng">
        <div className="au-stat"><span>Tổng tài khoản</span><strong>{stats.total.toLocaleString('vi-VN')}</strong></div>
        <div className="au-stat"><span>Đang hoạt động</span><strong>{stats.active.toLocaleString('vi-VN')}</strong></div>
        <div className="au-stat"><span>Admin & giảng viên</span><strong>{stats.staff.toLocaleString('vi-VN')}</strong></div>
        <div className="au-stat"><span>Có mã active</span><strong>{stats.coded.toLocaleString('vi-VN')}</strong></div>
      </div>

      <StatusBanner banner={banner} />
      {cohortsError && <div className="au-inline-warning" role="alert">Không tải được danh sách lớp: {cohortsError}. Chức năng tạo mã Trực tiếp tạm thời chưa dùng được.</div>}

      <div className="au-toolbar">
        <Field label="Vai trò">
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">Tất cả vai trò</option>
            {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Tìm tài khoản">
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên hoặc email…" />
        </Field>
        <button className="adm-btn-secondary" type="button" onClick={() => { setRole(''); setSearch(''); }} disabled={!role && !search}>Xóa lọc</button>
        <button className="adm-btn-secondary" type="button" onClick={() => void loadUsers()} disabled={loading || mutationBusy}>{loading ? 'Đang tải…' : 'Tải lại'}</button>
      </div>

      {loadError && <div className="au-inline-error" role="alert">Không tải được người dùng: {loadError}</div>}
      {loading && !users.length ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState title="Không có tài khoản phù hợp" detail="Thử xóa bộ lọc hoặc tìm bằng email khác." />
      ) : (
        <div className="au-table-scroll" data-testid="users-table-scroll">
          <table className="au-table au-users-table">
            <thead><tr>
              <th><SortButton field="display_name" sort={sort} onSort={sortBy}>Người dùng</SortButton></th>
              <th>Mã kích hoạt</th>
              <th><SortButton field="code_type" sort={sort} onSort={sortBy}>Loại</SortButton></th>
              <th>Quyền</th>
              <th><SortButton field="code_status" sort={sort} onSort={sortBy}>Trạng thái mã</SortButton></th>
              <th><SortButton field="cohort_name" sort={sort} onSort={sortBy}>Lớp</SortButton></th>
              <th><SortButton field="role" sort={sort} onSort={sortBy}>Vai trò</SortButton></th>
              <th>Sessions hôm nay</th>
              <th>Tài khoản</th>
              <th><SortButton field="created_at" sort={sort} onSort={sortBy}>Ngày tạo</SortButton></th>
              <th>Thao tác</th>
            </tr></thead>
            <tbody>{rows.map((user) => {
              const summary = user.code_summary;
              const primary = summary.codes[0];
              return <tr key={user.id}>
                <td><div className="au-user-cell"><strong>{user.display_name || 'Chưa có tên'}</strong><span>{user.email || 'Chưa có email'}</span></div></td>
                <td>{primary ? <div className="au-code-cell"><code>{primary.code || '—'}</code>{summary.code_count > 1 && <span>+{summary.code_count - 1} mã</span>}</div> : <span className="au-muted">Chưa có mã</span>}</td>
                <td>{summary.code_type ? <span className="adm-chip">{codeTypeLabel(summary.code_type)}</span> : '—'}</td>
                <td><span className="au-permission-summary">{summary.permissions.length ? summary.permissions.join(', ') : '—'}</span></td>
                <td>{summary.has_active_code ? <span className="adm-status-pill is-active">Có mã active</span> : <span className="adm-status-pill is-inactive">Không có mã active</span>}</td>
                <td>{user.cohort_names.length ? <div className="au-cohort-list">{user.cohort_names.map((name) => <span className="adm-chip" key={name}>{name}</span>)}{user.cohort_lookup_failed ? <span className="au-warning-text">⚠ lookup failed</span> : null}</div> : user.cohort_lookup_failed ? <span className="au-warning-text">⚠ Không đọc được lớp</span> : user.cohort_name || '—'}</td>
                <td><span className={`au-role is-${user.role}`}>{user.role}</span></td>
                <td className="au-number">{user.sessions_today.toLocaleString('vi-VN')}</td>
                <td>{user.is_active ? <span className="adm-status-pill is-active">Active</span> : <span className="adm-status-pill is-revoked">Inactive</span>}</td>
                <td><time dateTime={user.created_at || undefined}>{formatDate(user.created_at)}</time></td>
                <td><div className="au-row-actions">
                  <label className="sr-only" htmlFor={`role-${user.id}`}>Đổi vai trò của {user.email}</label>
                  <select id={`role-${user.id}`} value={user.role} onChange={(event) => askRoleChange(user, event.target.value)} disabled={mutationBusy}>
                    {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setConvert({ user, studentCode: user.email.split('@')[0] || '', fullName: user.display_name || user.email, error: '' })}>Tạo hồ sơ HV</button>
                  {!summary.has_active_code && <button className="adm-btn-primary adm-btn-sm" type="button" onClick={() => setGenerate({ user, codeType: 'mass', cohortId: '', permissions: ['all'], sessionLimit: '', expiresAt: '', error: '' })}>Tạo + gán mã</button>}
                  {summary.has_active_code && primary && <button className="adm-btn-danger adm-btn-sm" type="button" onClick={() => setConfirm({
                    title: 'Gỡ người dùng khỏi mã',
                    body: `Gỡ ${user.email || user.display_name} khỏi mã ${primary.code}? Tài khoản sẽ mất quyền từ mã này ngay, nhưng lịch sử kích hoạt được giữ nguyên.`,
                    confirmLabel: 'Gỡ khỏi mã',
                    danger: true,
                    run: async () => mutate(
                      () => window.api.delete(`/admin/access-codes/${encodeURIComponent(primary.id)}/users/${encodeURIComponent(user.id)}`),
                      'Đã gỡ người dùng khỏi mã.',
                    ),
                  })}>Gỡ khỏi mã</button>}
                </div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}

      <ConfirmDialog state={confirm} busy={mutationBusy} onClose={() => setConfirm(null)} onConfirm={() => void runConfirm()} />

      <Dialog
        open={Boolean(convert)}
        title="Tạo hồ sơ học viên"
        description={convert ? `Liên kết hồ sơ roster cho ${convert.user.email || convert.user.id}.` : undefined}
        busy={mutationBusy}
        onClose={() => setConvert(null)}
        actions={<>
          <button className="adm-btn-secondary" type="button" onClick={() => setConvert(null)} disabled={mutationBusy}>Hủy</button>
          <button className="adm-btn-primary" type="button" onClick={() => void submitConvert()} disabled={mutationBusy}>{mutationBusy ? 'Đang tạo…' : 'Tạo hồ sơ'}</button>
        </>}
      >
        {convert && <>
          <Field label="Mã học viên"><input value={convert.studentCode} maxLength={64} onChange={(event) => setConvert({ ...convert, studentCode: event.target.value, error: '' })} /></Field>
          <Field label="Họ và tên"><input value={convert.fullName} maxLength={255} onChange={(event) => setConvert({ ...convert, fullName: event.target.value, error: '' })} /></Field>
          {convert.error && <div className="au-inline-error" role="alert">{convert.error}</div>}
        </>}
      </Dialog>

      <Dialog
        open={Boolean(generate)}
        title="Tạo và gán mã"
        description={generate ? `Mã mới được kích hoạt trực tiếp cho ${generate.user.email || generate.user.id}.` : undefined}
        busy={mutationBusy}
        onClose={() => setGenerate(null)}
        actions={<>
          <button className="adm-btn-secondary" type="button" onClick={() => setGenerate(null)} disabled={mutationBusy}>Hủy</button>
          <button className="adm-btn-primary" type="button" onClick={() => void submitGenerate()} disabled={mutationBusy}>{mutationBusy ? 'Đang tạo…' : 'Tạo + gán mã'}</button>
        </>}
      >
        {generate && <>
          <Field label="Loại mã">
            <select value={generate.codeType} onChange={(event) => setGenerate({ ...generate, codeType: event.target.value as GenerateDraft['codeType'], cohortId: event.target.value === 'direct' ? generate.cohortId : '', error: '' })}>
              {CODE_TYPES.map((item) => <option key={item} value={item}>{codeTypeLabel(item)}</option>)}
            </select>
          </Field>
          {generate.codeType === 'direct' && <Field label="Lớp">
            <select value={generate.cohortId} onChange={(event) => setGenerate({ ...generate, cohortId: event.target.value, error: '' })} disabled={Boolean(cohortsError)}>
              <option value="">Chọn lớp…</option>
              {cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}
            </select>
          </Field>}
          <PermissionsPicker value={generate.permissions} onChange={(permissions) => setGenerate({ ...generate, permissions, error: '' })} />
          <div className="au-form-grid">
            <Field label="Giới hạn sessions" hint="Để trống nếu không giới hạn."><input type="number" min="1" value={generate.sessionLimit} onChange={(event) => setGenerate({ ...generate, sessionLimit: event.target.value, error: '' })} /></Field>
            <Field label="Ngày hết hạn" hint="Để trống nếu không hết hạn."><input type="date" value={generate.expiresAt} onChange={(event) => setGenerate({ ...generate, expiresAt: event.target.value, error: '' })} /></Field>
          </div>
          {generate.error && <div className="au-inline-error" role="alert">{generate.error}</div>}
        </>}
      </Dialog>
    </section>
  );
}
