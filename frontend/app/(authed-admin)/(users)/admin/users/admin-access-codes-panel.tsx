'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getAdminAccessCodes } from '@/lib/admin-users-api';
import {
  activeAssignmentCount,
  codeLedgerState,
  grantCreditsLabel,
  normalizeCodesPayload,
  quotaLabel,
  selectCodes,
  validateCodeDraft,
} from '@/lib/admin-users-model.mjs';

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
  RowMenu,
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

type LedgerFilter = '' | 'unused' | 'used' | 'expired' | 'revoked';

const LEDGER_FILTERS: { value: LedgerFilter; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'unused', label: 'Chưa dùng' },
  { value: 'used', label: 'Đã dùng' },
  { value: 'expired', label: 'Hết hạn nhập' },
  { value: 'revoked', label: 'Đã thu hồi' },
];

const LEDGER_PILL: Record<Exclude<LedgerFilter, ''>, string> = {
  unused: 'is-active',
  used: 'is-draft',
  expired: 'is-inactive',
  revoked: 'is-revoked',
};

type EditDraft = {
  code: AccessCode;
  permissions: string[];
  sessionLimit: string;
  error: string;
};

// ADMINIA-0074 FR-048/055: the activation-code ledger. Codes are created only
// from a class (its "Cấp mã kích hoạt cho lớp" dialog), so this page has no
// create form; "Tạo mã cho một lớp" picks the class and opens its page.
export function AdminAccessCodesPanel({ profileId, cohorts, cohortsError, expiringDays }: {
  profileId: string;
  cohorts: AdminCohort[];
  cohortsError: string | null;
  expiringDays: number;
}) {
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [type, setType] = useState('');
  const [status, setStatus] = useState<LedgerFilter>('');
  const [cohort, setCohort] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ field: 'created_at', order: 'desc' });
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [classPicker, setClassPicker] = useState<null | { cohortId: string; error: string }>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const sequence = useRef(0);

  const loadCodes = useCallback(async (silent = false) => {
    const requestId = ++sequence.current;
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const payload = normalizeCodesPayload(await getAdminAccessCodes()) as AccessCode[];
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

  // One clock per load so every row and stat agrees on "now".
  const ledgerNow = useMemo(() => Date.now(), [codes]);
  const ledger = useMemo(() => new Map(codes.map((code) => [
    code.id,
    codeLedgerState(code, { now: ledgerNow, expiringDays }) as { state: Exclude<LedgerFilter, ''>; label: string; expiringSoon: boolean },
  ])), [codes, ledgerNow, expiringDays]);
  const rows = useMemo(
    () => (selectCodes(codes, { type, status: 'all', cohort, search }, sort) as AccessCode[])
      .filter((code) => !status || ledger.get(code.id)?.state === status),
    [codes, type, status, cohort, search, sort, ledger],
  );
  const stats = useMemo(() => {
    const count = (state: LedgerFilter) => codes.filter((code) => ledger.get(code.id)?.state === state).length;
    return { total: codes.length, unused: count('unused'), used: count('used'), revoked: count('revoked') };
  }, [codes, ledger]);

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

  const openClass = () => {
    if (!classPicker) return;
    if (!classPicker.cohortId) {
      setClassPicker({ ...classPicker, error: 'Chọn một lớp trước.' });
      return;
    }
    // Spec 0074 T029 adds the class page's "Cấp mã kích hoạt cho lớp" dialog;
    // until then the class page itself is the destination.
    window.location.assign(`/admin/classes/${encodeURIComponent(classPicker.cohortId)}`);
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
    <section id="codes-panel" className="au-pane" aria-label="Sổ tra cứu mã kích hoạt">
      <div className="au-stat-grid" aria-label="Tổng quan mã kích hoạt">
        <div className="au-stat"><span>Tổng mã</span><strong>{stats.total.toLocaleString('vi-VN')}</strong></div>
        <div className="au-stat"><span>Chưa dùng</span><strong>{stats.unused.toLocaleString('vi-VN')}</strong></div>
        <div className="au-stat"><span>Đã dùng</span><strong>{stats.used.toLocaleString('vi-VN')}</strong></div>
        <div className="au-stat"><span>Đã thu hồi</span><strong>{stats.revoked.toLocaleString('vi-VN')}</strong></div>
      </div>

      <StatusBanner banner={banner} />
      {cohortsError && <div className="au-inline-warning" role="alert">Không tải được danh sách lớp: {cohortsError}. Bộ lọc lớp và nút Tạo mã cho một lớp tạm thời chưa dùng được.</div>}

      <div className="au-toolbar au-toolbar--codes">
        <Field label="Loại mã">
          <select value={type} onChange={(event) => setType(event.target.value)}><option value="">Tất cả</option>{CODE_TYPES.map((item) => <option key={item} value={item}>{codeTypeLabel(item)}</option>)}</select>
        </Field>
        <Field label="Trạng thái">
          <select value={status} onChange={(event) => setStatus(event.target.value as LedgerFilter)}>{LEDGER_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </Field>
        <Field label="Lớp">
          <select value={cohort} onChange={(event) => setCohort(event.target.value)} disabled={Boolean(cohortsError)}><option value="">Tất cả</option>{cohorts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </Field>
        <Field label="Tìm kiếm">
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mã hoặc email…" />
        </Field>
        <button className="adm-btn-secondary" type="button" onClick={resetFilters} disabled={!type && !status && !cohort && !search}>Xóa lọc</button>
        <button className="adm-btn-secondary" type="button" onClick={() => void loadCodes()} disabled={loading || mutationBusy}>{loading ? 'Đang tải…' : 'Tải lại'}</button>
        <button className="adm-btn-primary" type="button" onClick={() => setClassPicker({ cohortId: '', error: '' })} disabled={Boolean(cohortsError)}>Tạo mã cho một lớp</button>
      </div>

      {loadError && <div className="au-inline-error" role="alert">Không tải được mã kích hoạt: {loadError}</div>}
      {loading && !codes.length ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState title="Không có mã phù hợp" detail="Thử đổi bộ lọc, hoặc tạo mã từ trang của một lớp." />
      ) : (
        <div className="au-table-scroll" data-testid="codes-table-scroll">
          <table className="au-table au-codes-table">
            <thead><tr>
              <th>Mã</th><th>Loại</th><th>Lớp</th><th>Người dùng</th>
              <th><SortButton field="status" sort={sort} onSort={sortBy}>Trạng thái</SortButton></th>
              <th>Giới hạn</th>
              <th>Số lượt chấm cấp kèm mã</th>
              <th><SortButton field="expires_at" sort={sort} onSort={sortBy}>Hết hạn</SortButton></th>
              <th><SortButton field="created_at" sort={sort} onSort={sortBy}>Ngày tạo</SortButton></th>
              <th>Ghi chú</th><th>Thao tác</th>
            </tr></thead>
            <tbody>{rows.map((code) => {
              const activeAssignments = activeAssignmentCount(code);
              const entry = ledger.get(code.id);
              return <tr key={code.id}>
              <td><a className="au-code-link" href={`/admin/activation-codes/${encodeURIComponent(code.id)}`} title="Mở trang mã"><code className="au-code-value">{code.code || '—'}</code></a></td>
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
              <td><div className="au-ledger-status" data-ledger-state={entry?.state}>
                <span className={`adm-status-pill ${LEDGER_PILL[entry?.state || 'unused']}`}>{entry?.label}</span>
                {entry?.state === 'used' && code.used_at && <small>ngày {formatDate(code.used_at)}</small>}
                {entry?.expiringSoon && <span className="adm-status-pill is-new" data-testid="code-expiring">sắp hết hạn</span>}
                {!code.is_revoked && !code.is_active && <small>Đã khóa</small>}
              </div></td>
              <td className="au-number">{code.session_limit == null ? '∞' : code.session_limit.toLocaleString('vi-VN')}</td>
              <td className={code.grant_credits == null ? '' : 'au-number'}>{code.grant_credits == null ? <span className="au-muted">{grantCreditsLabel(code)}</span> : grantCreditsLabel(code)}</td>
              <td>{formatDate(code.expires_at)}</td>
              <td>{formatDate(code.created_at)}</td>
              <td><span className="au-notes">{code.notes || '—'}</span></td>
              <td><div className="au-row-actions">
                <a className="adm-btn-secondary adm-btn-sm" href={`/admin/usage?code_id=${encodeURIComponent(code.id)}`}>Hoạt động</a>
                {!code.is_revoked && code.is_active && <RowMenu label={`Thao tác khác với mã ${code.code}`} items={[
                  {
                    label: 'Sửa quyền',
                    onSelect: () => setEdit({ code, permissions: [...code.permissions], sessionLimit: code.session_limit == null ? '' : String(code.session_limit), error: '' }),
                  },
                  {
                    label: 'Cấp mã mới',
                    onSelect: () => setConfirm({
                      title: 'Cấp mã mới',
                      body: `Tạo mã mới sao chép quyền, lớp và giới hạn của ${code.code} cho người dùng hiện tại? Mã cũ được giữ nguyên.`,
                      confirmLabel: 'Cấp mã mới',
                      run: async () => mutate(
                        () => window.api.post(`/admin/access-codes/${encodeURIComponent(code.id)}/refill`, {}),
                        'Đã cấp mã mới.',
                      ),
                    }),
                  },
                  // FR-055: revoking an unused code is the menu's last item.
                  {
                    label: 'Thu hồi mã',
                    danger: true,
                    // A used code (in use, or a legacy code with only
                    // used_by) is revoked with a reason in the code page's
                    // danger zone, not from this menu.
                    disabledReason: activeAssignments > 0 || entry?.state === 'used' ? 'Mã đã dùng; thu hồi ở Vùng nguy hiểm của trang mã.'
                      : code.association_lookup_failed ? 'Không xác minh được người đang dùng mã.' : undefined,
                    onSelect: () => setConfirm({
                      title: 'Thu hồi mã',
                      body: `Thu hồi mã ${code.code}? Hành động này không thể khôi phục.`,
                      confirmLabel: 'Thu hồi',
                      danger: true,
                      run: async () => mutate(
                        () => window.api.delete(`/admin/access-codes/${encodeURIComponent(code.id)}`),
                        'Đã thu hồi mã.',
                      ),
                    }),
                  },
                ]} />}
              </div></td>
            </tr>})}</tbody>
          </table>
        </div>
      )}

      <ConfirmDialog state={confirm} busy={mutationBusy} onClose={() => setConfirm(null)} onConfirm={() => void runConfirm()} />

      <Dialog
        open={Boolean(classPicker)}
        title="Tạo mã cho một lớp"
        description="Mã kích hoạt được cấp từ trang của lớp. Chọn lớp để mở trang đó."
        onClose={() => setClassPicker(null)}
        actions={<>
          <button className="adm-btn-secondary" type="button" onClick={() => setClassPicker(null)}>Hủy</button>
          <button className="adm-btn-primary" type="button" onClick={openClass}>Mở trang lớp</button>
        </>}
      >
        {classPicker && <>
          <Field label="Lớp">
            <select value={classPicker.cohortId} onChange={(event) => setClassPicker({ cohortId: event.target.value, error: '' })}>
              <option value="">Chọn lớp…</option>
              {cohorts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          {!cohorts.length && <p className="au-muted">Chưa có lớp đang hoạt động.</p>}
          {classPicker.error && <div className="au-inline-error" role="alert">{classPicker.error}</div>}
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
