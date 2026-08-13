'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import {
  isWritingEssayOverdue,
  normalizeBulkDelivery,
  normalizeSkipGrading,
  normalizeStartGrading,
  normalizeWritingQueueCohorts,
  normalizeWritingQueueFilters,
  normalizeWritingQueueList,
  writingMockMinimum,
  writingQueueApiPath,
  writingQueueDestination,
  writingQueueFetchKey,
  writingQueueSearch,
} from '@/lib/admin-writing-queue-model.mjs';

import type { QueueBanner, QueueCohort, QueueConfirm, QueueFilters, QueueLane, QueueRow } from './admin-writing-queue-types';

const LANES: { id: QueueLane; label: string; description: string }[] = [
  { id: 'grading', label: 'Đang chấm', description: 'AI đang xử lý' },
  { id: 'graded', label: 'Cần duyệt', description: 'Chờ kiểm tra feedback' },
  { id: 'reviewed', label: 'Chờ trả', description: 'Đã duyệt, chưa phát hành' },
  { id: 'delivered', label: 'Đã trả', description: 'Học viên đã nhận' },
  { id: 'all', label: 'Tất cả', description: 'Toàn bộ bài thường' },
  { id: 'mock', label: 'Mock Writing', description: 'Quyết định bài thi thử' },
];
const TASK_LABELS: Record<string, string> = { task1_academic: 'Task 1 · Academic', task1_general: 'Task 1 · General', task2: 'Task 2' };
const STATUS_LABELS: Record<string, string> = { pending: 'Chờ chấm', grading: 'Đang chấm', graded: 'Cần duyệt', reviewed: 'Chờ trả', delivered: 'Đã trả', failed: 'Chấm lỗi' };
const GRADING_POLL_MS = 8000;
const QUEUE_KEY = 'gradeQueue';

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Không rõ' : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function ageLabel(value: string | null) {
  if (!value) return '—';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return 'Không rõ';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} giờ` : `${Math.floor(hours / 24)} ngày`;
}

function taskLabel(task: string) {
  return TASK_LABELS[task] || task;
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] || status;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`awq-status is-${status}`}>{statusLabel(status)}</span>;
}

function RowBadges({ row, mock }: { row: QueueRow; mock: boolean }) {
  const minimum = writingMockMinimum(row.taskType);
  const short = row.wordCount < minimum;
  return <div className="awq-badges">
    {row.analysisLevel != null && <span title="Cấp độ phân tích AI">L{row.analysisLevel}</span>}
    {row.task1ImageMissing && <span className="is-warning" title="Task 1 được chấm khi thiếu hình đề">Thiếu hình</span>}
    {mock && <span className={short ? 'is-warning' : ''} title={`Tối thiểu ${minimum} từ`}>{row.wordCount} từ{short ? ` / ${minimum}` : ''}</span>}
  </div>;
}

export function AdminWritingQueue() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const filters = useMemo(() => normalizeWritingQueueFilters({
    status: params?.has('status') ? params.get('status') : undefined,
    cohort_id: params?.get('cohort_id') || '',
    overdue: params?.get('overdue') || '',
    mocklane: params?.get('mocklane') || '',
    embed: params?.get('embed') || '',
  }) as QueueFilters, [params]);
  const fetchKey = writingQueueFetchKey(filters);
  const keyedFetch = `${profile.id}\u0000${fetchKey}`;
  const currentViewKey = useRef(keyedFetch); currentViewKey.current = keyedFetch;
  const [snapshot, setSnapshot] = useState<{ key: string; rows: QueueRow[]; malformed: number; returned: number } | null>(null);
  const [cohortSnapshot, setCohortSnapshot] = useState<{ account: string; rows: QueueCohort[]; malformed: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cohortError, setCohortError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<QueueBanner>(null);
  const [confirm, setConfirm] = useState<QueueConfirm>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const queueSequences = useRef(new Map<string, number>());
  const cohortSequence = useRef(0);
  const mutationAccount = useRef('');
  const mutationSequence = useRef(0);
  const profileId = useRef(profile.id); profileId.current = profile.id;
  const rows = snapshot?.key === keyedFetch ? snapshot.rows : [];
  const cohorts = cohortSnapshot?.account === profile.id ? cohortSnapshot.rows : [];
  const hasSnapshot = snapshot?.key === keyedFetch;

  const loadQueue = useCallback(async (target: QueueFilters, silent = false): Promise<QueueRow[] | null> => {
    const account = profile.id;
    const key = `${account}\u0000${writingQueueFetchKey(target)}`;
    const requestId = (queueSequences.current.get(key) || 0) + 1;
    queueSequences.current.set(key, requestId);
    const isCurrentView = () => currentViewKey.current === key && profileId.current === account;
    if (!silent && isCurrentView()) setLoading(true);
    if (isCurrentView()) setLoadError(null);
    try {
      const normalized = normalizeWritingQueueList(await window.api.get<unknown>(writingQueueApiPath(target))) as { rows: QueueRow[]; malformedCount: number; returnedCount: number } | null;
      if (requestId !== queueSequences.current.get(key) || profileId.current !== account) return null;
      if (!normalized) throw new Error('Danh sách bài viết không đúng định dạng.');
      if (isCurrentView()) {
        setSnapshot({ key, rows: normalized.rows, malformed: normalized.malformedCount, returned: normalized.returnedCount });
        setSelected(new Set());
      }
      return normalized.rows;
    } catch (caught) {
      if (requestId === queueSequences.current.get(key) && isCurrentView()) setLoadError(messageOf(caught));
      return null;
    } finally {
      if (requestId === queueSequences.current.get(key) && isCurrentView()) setLoading(false);
    }
  }, [profile.id]);

  const loadCohorts = useCallback(async () => {
    const account = profile.id;
    const requestId = ++cohortSequence.current;
    setCohortError(null);
    try {
      const normalized = normalizeWritingQueueCohorts(await window.api.get<unknown>('/admin/cohorts?is_active=true')) as { rows: QueueCohort[]; malformedCount: number } | null;
      if (requestId !== cohortSequence.current || profileId.current !== account) return;
      if (!normalized) throw new Error('Danh sách lớp không đúng định dạng.');
      setCohortSnapshot({ account, rows: normalized.rows, malformed: normalized.malformedCount });
    } catch (caught) {
      if (requestId === cohortSequence.current && profileId.current === account) setCohortError(messageOf(caught));
    }
  }, [profile.id]);

  useEffect(() => {
    setConfirm(null);
    setBusyId(null);
    mutationAccount.current = '';
    mutationSequence.current += 1;
    setBanner(null);
    setSelected(new Set());
  }, [profile.id]);

  useEffect(() => {
    setConfirm(null);
    setBanner(null);
    setSelected(new Set());
    void loadQueue(filters);
  }, [keyedFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCohortSnapshot(null);
    void loadCohorts();
    return () => { cohortSequence.current += 1; };
  }, [profile.id, loadCohorts]);

  useEffect(() => { setSelected(new Set()); }, [filters.overdue]);

  useEffect(() => {
    if (filters.lane !== 'grading') return;
    const timer = window.setInterval(() => {
      if (!document.hidden && mutationAccount.current !== profile.id) void loadQueue(filters, true);
    }, GRADING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [filters, loadQueue]);

  const visibleRows = useMemo(() => filters.overdue ? rows.filter((row) => isWritingEssayOverdue(row)) : rows, [filters.overdue, rows]);
  const bulkable = filters.lane === 'reviewed';
  const selectedVisible = visibleRows.filter((row) => selected.has(row.id));
  const allSelected = bulkable && visibleRows.length > 0 && selectedVisible.length === visibleRows.length;
  const stale = Boolean(loadError && hasSnapshot);
  const malformed = hasSnapshot ? snapshot?.malformed || 0 : 0;
  const atCap = hasSnapshot && snapshot?.returned === 200;
  const activeLane = LANES.find((lane) => lane.id === filters.lane)!;
  const selectedCohortKnown = !filters.cohortId || cohorts.some((cohort) => cohort.id === filters.cohortId);

  const navigate = (next: QueueFilters) => {
    if (busyId) return;
    const search = writingQueueSearch(next);
    router.replace(`/admin/writing/queue${search ? `?${search}` : ''}`, { scroll: false });
  };

  const setLane = (lane: QueueLane) => navigate({ ...filters, lane, overdue: false });
  const setCohort = (cohortId: string) => navigate({ ...filters, cohortId });
  const setOverdue = (overdue: boolean) => navigate({ ...filters, overdue });

  const openRow = (row: QueueRow) => {
    if (busyId) return;
    const live = (row.status === 'pending' && !row.gradingSkippedAt) || row.status === 'grading';
    if (!live) {
      try {
        const ids = visibleRows.map((item) => item.id);
        sessionStorage.setItem(QUEUE_KEY, JSON.stringify({ ids, i: ids.indexOf(row.id), status: filters.lane === 'all' || filters.lane === 'mock' ? '' : filters.lane }));
      } catch { /* grade workspace falls back to a single essay */ }
    }
    window.location.href = writingQueueDestination(row, filters);
  };

  const toggleOne = (id: string, on: boolean) => setSelected((previous) => {
    const next = new Set(previous);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(visibleRows.map((row) => row.id)) : new Set());

  const runMutation = async () => {
    const action = confirm;
    const account = profile.id;
    if (!action || mutationAccount.current === account) return;
    const view = keyedFetch;
    const operationId = ++mutationSequence.current;
    mutationAccount.current = account;
    setBusyId(action.kind === 'deliver' ? 'bulk' : action.row.id);
    setBanner(null);
    try {
      if (action.kind === 'deliver') {
        const result = normalizeBulkDelivery(
          await window.api.post<unknown>('/admin/writing/essays/bulk-mark-delivered', { essay_ids: action.ids }),
          action.ids,
        ) as { delivered: string[]; skipped: { id: string }[] } | null;
        if (!result) throw new Error('Máy chủ không xác nhận đầy đủ kết quả trả bài.');
        const canonical = await loadQueue(filters, true);
        if (!canonical) throw new Error('Yêu cầu đã được tiếp nhận nhưng chưa đọc lại được trạng thái canonical. Hãy tải lại trước khi thao tác tiếp.');
        const stillReviewed = canonical.filter((row) => result.delivered.includes(row.id));
        if (stillReviewed.length) throw new Error(`${stillReviewed.length} bài vẫn còn ở lane Chờ trả sau khi đọc lại. Chưa thể xác nhận hoàn tất.`);
        if (currentViewKey.current === view) {
          setSelected(new Set());
          setBanner({ kind: result.skipped.length ? 'error' : 'success', text: result.skipped.length
            ? `Đã trả ${result.delivered.length} bài; ${result.skipped.length} bài bị backend bỏ qua vì không còn ở trạng thái đã duyệt.`
            : `Đã trả ${result.delivered.length} bài và đồng bộ lại từ máy chủ.` });
        }
      } else if (action.kind === 'grade') {
        const acknowledged = normalizeStartGrading(
          await window.api.post<unknown>(`/admin/writing/essays/${encodeURIComponent(action.row.id)}/start-grading`, { grading_tier: 'standard' }),
          action.row.id,
        );
        if (!acknowledged) throw new Error('Máy chủ không xác nhận đúng bài đã đưa vào hàng chấm.');
        const canonical = await loadQueue(filters, true);
        const current = canonical?.find((row) => row.id === action.row.id);
        if (!canonical || !current || !['grading', 'graded', 'reviewed', 'delivered'].includes(current.status)) throw new Error('Đã gửi yêu cầu nhưng chưa xác minh được bài đã rời trạng thái Chờ chấm.');
        if (currentViewKey.current === view) setBanner({ kind: 'success', text: 'Đã đưa bài vào hàng chấm và đồng bộ lại từ máy chủ.' });
      } else {
        const acknowledged = normalizeSkipGrading(
          await window.api.post<unknown>(`/admin/mock-exams/writing/essays/${encodeURIComponent(action.row.id)}/skip-grading`, {}),
          action.row.id,
        );
        if (!acknowledged) throw new Error('Máy chủ không xác nhận đúng bài được bỏ qua.');
        const canonical = await loadQueue(filters, true);
        const current = canonical?.find((row) => row.id === action.row.id);
        if (!canonical || !current?.gradingSkippedAt) throw new Error('Đã gửi yêu cầu nhưng chưa xác minh được dấu bỏ qua chấm từ máy chủ.');
        if (currentViewKey.current === view) setBanner({ kind: 'success', text: 'Đã bỏ qua chấm bài ngắn và đồng bộ lại từ máy chủ.' });
      }
      if (profileId.current !== account || mutationSequence.current !== operationId) return;
      if (currentViewKey.current === view) setConfirm(null);
    } catch (caught) {
      if (profileId.current === account && currentViewKey.current === view && mutationSequence.current === operationId) setBanner({ kind: 'error', text: messageOf(caught) });
    } finally {
      if (mutationSequence.current === operationId && mutationAccount.current === account) mutationAccount.current = '';
      if (profileId.current === account && mutationSequence.current === operationId) setBusyId(null);
    }
  };

  const confirmCopy = confirm?.kind === 'deliver'
    ? { title: `Trả ${confirm.ids.length} bài cho học viên?`, description: 'Chỉ bài vẫn ở trạng thái Chờ trả mới được phát hành. Backend sẽ kiểm lại từng bài và màn hình sẽ đọc lại trạng thái sau thao tác.', button: 'Trả bài đã chọn' }
    : confirm?.kind === 'skip'
      ? { title: 'Bỏ qua chấm bài Writing này?', description: 'Học viên vẫn nhận band Writing do giám khảo nhập nhưng không có bài chữa cho phần này. Chỉ bài Mock pending và dưới mức từ tối thiểu mới được phép bỏ qua.', button: 'Bỏ qua chấm' }
      : { title: 'Đưa bài vào hàng chấm?', description: 'Thao tác này bắt đầu một lượt chấm AI tiêu chuẩn. Với bài ngắn, đây là quyết định chấm dù chưa đạt số từ IELTS tối thiểu.', button: 'Bắt đầu chấm' };

  return <main className={`awq-shell${filters.embed ? ' is-embedded' : ''}`}>
    {!filters.embed && <header className="awq-header">
      <div><p className="awq-eyebrow">Writing · Quality control</p><h1>Hàng chờ chấm</h1><p>Điều phối từng bài từ AI grading đến review và phát hành — không trộn bài Mock vào hàng thường.</p></div>
      <a className="awq-hub-link" href="/admin/writing">Writing workspace <span aria-hidden="true">↗</span></a>
    </header>}

    <StatusBanner banner={banner} />
    {loadError && <div className="awq-warning" role="alert"><strong>{stale ? 'Đang hiển thị snapshot gần nhất.' : 'Không tải được hàng chờ.'}</strong><span>{loadError}</span><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void loadQueue(filters)}>Tải lại</button></div>}
    {cohortError && <div className="awq-warning" role="alert"><strong>Không đọc được danh sách lớp.</strong><span>Bộ lọc lớp có thể thiếu dữ liệu: {cohortError}</span><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void loadCohorts()}>Thử lại</button></div>}
    {(malformed > 0 || (cohortSnapshot?.account === profile.id && cohortSnapshot.malformed > 0)) && <div className="awq-warning" role="alert"><strong>Dữ liệu chưa đầy đủ.</strong><span>{malformed > 0 ? `${malformed} bài sai định dạng đã được loại khỏi bảng. ` : ''}{cohortSnapshot?.malformed ? `${cohortSnapshot.malformed} lớp sai định dạng đã được loại khỏi bộ lọc.` : ''}</span></div>}

    {!filters.embed && <nav className="awq-lanes" aria-label="Luồng trạng thái Writing">
      {LANES.map((lane) => <button key={lane.id} type="button" disabled={Boolean(busyId)} className={lane.id === filters.lane ? 'is-active' : ''} aria-current={lane.id === filters.lane ? 'page' : undefined} onClick={() => setLane(lane.id)}><strong>{lane.label}</strong><span>{lane.description}</span></button>)}
    </nav>}

    <section className="awq-workspace" aria-labelledby="awq-workspace-title">
      <header className="awq-workspace__head">
        <div><p className="awq-eyebrow">Lane hiện tại</p><h2 id="awq-workspace-title">{activeLane.label}</h2><p>{activeLane.description}{filters.lane === 'grading' ? ' · tự làm mới mỗi 8 giây khi tab đang mở' : ''}</p></div>
        <div className="awq-count"><strong>{visibleRows.length}</strong><span>{filters.overdue ? 'bài quá hạn' : 'bài hiển thị'}</span></div>
      </header>

      {!filters.embed && <div className="awq-toolbar">
        <label><span>Lớp học</span><select value={filters.cohortId} onChange={(event) => setCohort(event.target.value)} disabled={Boolean(busyId || (cohortError && !cohorts.length))}><option value="">Tất cả lớp</option>{!selectedCohortKnown && <option value={filters.cohortId}>Lớp không còn trong danh mục · {filters.cohortId}</option>}{cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</select></label>
        <label className="awq-overdue"><input type="checkbox" checked={filters.overdue} disabled={Boolean(busyId)} onChange={(event) => setOverdue(event.target.checked)} /><span><strong>Chỉ bài quá hạn</strong><small>Deadline đã qua, chưa trả</small></span></label>
        <button type="button" className="adm-btn-secondary" disabled={Boolean(loading || busyId)} onClick={() => void loadQueue(filters)}>{loading ? 'Đang tải…' : 'Làm mới'}</button>
      </div>}

      {bulkable && selected.size > 0 && <div className="awq-bulk"><span aria-live="polite"><strong>{selected.size} bài đã chọn</strong><small>Backend sẽ kiểm lại trạng thái từng bài.</small></span><button className="adm-btn-primary" type="button" disabled={Boolean(busyId)} onClick={() => setConfirm({ kind: 'deliver', ids: [...selected] })}>Trả bài đã chọn</button></div>}
      {atCap && <div className="awq-cap" role="status">Đang hiển thị giới hạn 200 bài mới nhất. Hãy lọc theo lớp hoặc trạng thái để thu hẹp kết quả.</div>}
      {loading && !hasSnapshot && <div className="awq-state" role="status"><span className="awq-spinner" aria-hidden="true" /><strong>Đang tải hàng chờ…</strong><span>Đọc bài viết và trạng thái canonical từ máy chủ.</span></div>}
      {!loading && !hasSnapshot && loadError && <div className="awq-state is-error"><strong>Chưa có dữ liệu để hiển thị</strong><span>Khắc phục lỗi phía trên rồi thử tải lại.</span></div>}
      {hasSnapshot && !visibleRows.length && <div className="awq-state"><strong>Lane này đang trống</strong><span>{filters.overdue ? 'Không có bài quá hạn trong phạm vi đã chọn.' : 'Không có bài nào khớp lớp và trạng thái hiện tại.'}</span></div>}

      {hasSnapshot && visibleRows.length > 0 && <div className="awq-table-wrap">
        <table className="awq-table">
          <thead><tr>
            {bulkable && <th className="awq-check"><input type="checkbox" aria-label="Chọn tất cả bài đang hiển thị" checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} /></th>}
            <th>Học viên</th><th>Task</th><th>Trạng thái</th><th>Band</th><th>Đã nộp</th><th>Hạn trả</th><th>Thao tác</th>
          </tr></thead>
          <tbody>{visibleRows.map((row) => {
            const overdue = isWritingEssayOverdue(row);
            const minimum = writingMockMinimum(row.taskType);
            const short = row.wordCount < minimum;
            return <tr key={row.id} className={overdue ? 'is-overdue' : ''}>
              {bulkable && <td className="awq-check" data-label="Chọn"><input type="checkbox" aria-label={`Chọn bài của ${row.studentName || row.studentCode || 'học viên không rõ'}`} checked={selected.has(row.id)} onChange={(event) => toggleOne(row.id, event.target.checked)} /></td>}
              <td data-label="Học viên"><div className="awq-student"><strong>{row.studentName || 'Không rõ học viên'}</strong><span>{row.studentCode || row.studentId || 'Không có mã'}</span></div></td>
              <td data-label="Task"><strong>{taskLabel(row.taskType)}</strong><RowBadges row={row} mock={filters.lane === 'mock'} /></td>
              <td data-label="Trạng thái"><StatusPill status={row.status} />{row.gradingSkippedAt && <small className="awq-resolved">Đã bỏ qua chấm</small>}{row.status === 'failed' && row.errorMessage && <small className="awq-error-copy">{row.errorMessage}</small>}</td>
              <td data-label="Band"><strong className="awq-band">{row.band == null ? '—' : row.band.toFixed(1)}</strong></td>
              <td data-label="Đã nộp"><span>{ageLabel(row.createdAt)}</span><small>{formatDate(row.createdAt)}</small></td>
              <td data-label="Hạn trả"><span className={overdue ? 'awq-deadline' : ''}>{formatDate(row.deadline)}{overdue ? ' · Quá hạn' : ''}</span></td>
              <td data-label="Thao tác"><div className="awq-actions">
                {filters.lane === 'mock' && row.status === 'pending' && !row.gradingSkippedAt && <>
                  <button className="adm-btn-primary adm-btn-sm" type="button" disabled={Boolean(busyId)} onClick={() => setConfirm({ kind: 'grade', row })}>{short ? 'Chấm dù ngắn' : 'Bắt đầu chấm'}</button>
                  {short && <button className="adm-btn-secondary adm-btn-sm" type="button" disabled={Boolean(busyId)} onClick={() => setConfirm({ kind: 'skip', row })}>Bỏ qua</button>}
                </>}
                <button className="adm-btn-secondary adm-btn-sm" type="button" disabled={Boolean(busyId)} onClick={() => openRow(row)}>{(row.status === 'pending' && !row.gradingSkippedAt) || row.status === 'grading' ? 'Xem tiến trình' : 'Mở bài'}</button>
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </section>

    <Dialog open={Boolean(confirm && hasSnapshot)} title={confirmCopy.title} description={confirmCopy.description} busy={Boolean(busyId)} onClose={() => setConfirm(null)} actions={<>
      <button className="adm-btn-secondary" type="button" disabled={Boolean(busyId)} onClick={() => setConfirm(null)}>Hủy</button>
      <button className="adm-btn-primary" type="button" disabled={Boolean(busyId)} onClick={() => void runMutation()}>{busyId ? 'Đang xử lý…' : confirmCopy.button}</button>
    </>} />
  </main>;
}
