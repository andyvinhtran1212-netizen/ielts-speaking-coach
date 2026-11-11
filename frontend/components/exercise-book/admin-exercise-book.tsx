'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Dialog, Field, StatusBanner } from '@/components/admin-directory-ui';
import { useExerciseBookApi } from '@/lib/exercise-book/api-context';
import type {
  ActivityReview,
  AssignmentCreate,
  AssignmentProgress,
  AssignmentReceipt,
  AssignmentSummary,
  ErrorCode,
  ProgressCell,
  SourceCatalog,
} from '@/lib/exercise-book/contract';
import {
  CELL_STATUS_LABEL,
  codeText,
  errorCode,
  errorText,
  formatVnTime,
  readinessText,
  vnLocalToIso,
} from '@/lib/exercise-book/model';

import { ExerciseBookReview, labelsFor } from './exercise-book-review';

const MAX_ACTIVITIES = 17;
const MAX_RECIPIENTS = 500;
const MAX_CELLS = 8500;
const MAX_DUE_DAYS = 180;

type Banner = { kind: 'success' | 'error'; text: string } | null;

export const adminExerciseBookHref = (cohortId: string) => `/admin/classes/${encodeURIComponent(cohortId)}/exercise-book`;
export const adminGrantsHref = (cohortId: string) => `/admin/classes/${encodeURIComponent(cohortId)}/exercise-book/grants`;

function gateText(code: ErrorCode) {
  if (code === 'forbidden' || code === 'not_owner') return 'Bạn chưa được cấp quyền giao sách bài tập cho lớp này.';
  if (code === 'not_found') return 'Lớp này chưa có sách bài tập, hoặc bạn không có quyền xem.';
  return codeText(code);
}

/** Client checks mirror contract §2; the server stays authoritative. */
export function draftProblem(draft: { activityIds: string[]; recipientIds: string[]; dueLocal: string }, now: number) {
  if (!draft.activityIds.length) return 'Chọn ít nhất một activity.';
  if (draft.activityIds.length > MAX_ACTIVITIES) return `Tối đa ${MAX_ACTIVITIES} activity cho một bài giao.`;
  if (!draft.recipientIds.length) return 'Chọn ít nhất một học viên.';
  if (draft.recipientIds.length > MAX_RECIPIENTS) return `Tối đa ${MAX_RECIPIENTS} học viên cho một bài giao.`;
  if (draft.activityIds.length * draft.recipientIds.length > MAX_CELLS) return `Số activity × số học viên tối đa là ${MAX_CELLS}.`;
  const due = Date.parse(vnLocalToIso(draft.dueLocal));
  if (!Number.isFinite(due)) return 'Chọn hạn nộp.';
  if (due <= now) return 'Hạn nộp phải ở tương lai.';
  if (due > now + MAX_DUE_DAYS * 86_400_000) return `Hạn nộp tối đa ${MAX_DUE_DAYS} ngày kể từ hôm nay.`;
  return '';
}

export function AdminExerciseBook({ cohortId }: { cohortId: string }) {
  return <AdminExerciseBookSession key={cohortId} cohortId={cohortId} />;
}

function AdminExerciseBookSession({ cohortId }: { cohortId: string }) {
  const api = useExerciseBookApi();
  const [catalog, setCatalog] = useState<SourceCatalog | null>(null);
  const [gate, setGate] = useState<{ code: ErrorCode } | null>(null);
  const [summaries, setSummaries] = useState<AssignmentSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);

  const loadCatalog = useCallback(async () => {
    setGate(null);
    try {
      setCatalog(await api.getCatalog(cohortId));
    } catch (caught) {
      setCatalog(null);
      setGate({ code: errorCode(caught) });
    }
  }, [api, cohortId]);

  const loadList = useCallback(async (next: string | null) => {
    setListError('');
    try {
      const page = await api.listAssignments(cohortId, { cursor: next });
      setSummaries((current) => (next && current ? [...current, ...page.items] : page.items));
      setCursor(page.next_cursor);
    } catch (caught) {
      setListError(errorText(caught));
    }
  }, [api, cohortId]);

  useEffect(() => {
    void loadCatalog();
    void loadList(null);
  }, [loadCatalog, loadList]);

  if (gate) {
    return (
      <section className="acd-state is-error" role="alert">
        <strong>Không mở được sách bài tập</strong>
        <span>{gateText(gate.code)}</span>
        <button className="adm-btn-secondary" type="button" onClick={() => void loadCatalog()}>Thử lại</button>
      </section>
    );
  }
  if (!catalog) return <div className="acd-state" role="status">Đang tải sách bài tập…</div>;

  return (
    <div className="ach-workspace">
      <StatusBanner banner={banner} />
      <AssignForm cohortId={cohortId} catalog={catalog} onCreated={(receipt) => {
        setBanner({ kind: 'success', text: 'Đã giao bài. Biên nhận và tiến độ ở bên dưới.' });
        setSelected(receipt.assignment_id);
        void loadList(null);
      }} />
      <section aria-labelledby="exercise-book-list-title">
        <div className="acx-section-head"><h2 id="exercise-book-list-title">Bài sách bài tập đã giao</h2></div>
        {listError && (
          <div className="acd-warning" role="alert">
            <span>{listError}</span>
            <button className="adm-btn-secondary" type="button" onClick={() => void loadList(null)}>Thử lại</button>
          </div>
        )}
        {!summaries && !listError && <div className="acd-state" role="status">Đang tải danh sách bài giao…</div>}
        {summaries && !summaries.length && <p>Lớp chưa có bài sách bài tập nào.</p>}
        {summaries && summaries.length > 0 && (
          <div className="acd-table-scroll" role="region" tabIndex={0} aria-label="Danh sách bài sách bài tập">
            <table className="acd-table">
              <thead><tr><th scope="col">Bài giao</th><th scope="col">Trạng thái</th><th scope="col">Hạn nộp</th><th scope="col">Activity</th><th scope="col">Học viên</th><th scope="col">Tạo lúc</th><th scope="col"><span className="sr-only">Mở</span></th></tr></thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.assignment_id} aria-current={summary.assignment_id === selected ? 'true' : undefined}>
                    <th scope="row">{summary.title}</th>
                    <td>{summary.status === 'published' ? 'Đang mở' : 'Đã đóng'}</td>
                    <td>{formatVnTime(summary.due_at)}</td>
                    <td>{summary.activity_count}</td>
                    <td>{summary.recipient_count}</td>
                    <td>{formatVnTime(summary.created_at)}</td>
                    <td><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setSelected(summary.assignment_id)}>Xem tiến độ</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && <button className="adm-btn-secondary" type="button" onClick={() => void loadList(cursor)}>Xem thêm</button>}
      </section>
      {selected && (
        <AssignmentPanel key={selected} cohortId={cohortId} assignmentId={selected} catalog={catalog}
          onArchived={() => { setBanner({ kind: 'success', text: 'Đã đóng bài giao. Bài đã nộp vẫn được giữ.' }); void loadList(null); }} />
      )}
    </div>
  );
}

function AssignForm({ cohortId, catalog, onCreated }: {
  cohortId: string;
  catalog: SourceCatalog;
  onCreated: (receipt: AssignmentReceipt) => void;
}) {
  const api = useExerciseBookApi();
  const [activityIds, setActivityIds] = useState<string[]>([]);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [dueLocal, setDueLocal] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [problem, setProblem] = useState('');
  // Same draft → same request_id, so a retry after a lost ACK replays instead of duplicating (contract §2).
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const lookupFailed = catalog.lookup_errors.length > 0;
  const activities = catalog.inventory.activities;
  const recipients = catalog.eligible_recipients;
  const names = useMemo(() => new Map(recipients.map((entry) => [entry.student_id, entry.display_name])), [recipients]);

  function toggle(list: string[], value: string, update: (next: string[]) => void) {
    update(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
  }

  function review() {
    const found = draftProblem({ activityIds, recipientIds, dueLocal }, Date.now());
    setProblem(found);
    if (!found) setConfirming(true);
  }

  async function create() {
    if (busy) return;
    const body: Omit<AssignmentCreate, 'request_id'> = {
      // Catalog order, not click order (contract §2: "theo thứ tự").
      activities: activities.filter((entry) => activityIds.includes(entry.binding.activity_id)).map((entry) => entry.binding),
      recipient_ids: recipients.filter((entry) => recipientIds.includes(entry.student_id)).map((entry) => entry.student_id),
      due_at: vnLocalToIso(dueLocal),
      deadline_timezone: 'Asia/Ho_Chi_Minh',
      replay_policy: 'allowed',
    };
    const fingerprint = JSON.stringify(body);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const receipt = await api.createAssignment(cohortId, { ...body, request_id: request.current.id });
      request.current = null;
      setConfirming(false);
      setActivityIds([]);
      setRecipientIds([]);
      setDueLocal('');
      onCreated(receipt);
    } catch (caught) {
      const code = errorCode(caught);
      if (code !== 'network' && code !== 'unavailable') request.current = null;
      setError(code === 'network'
        ? 'Chưa xác nhận được việc giao bài. Bấm “Giao bài” lần nữa sẽ gửi lại cùng mã yêu cầu, không tạo bài trùng.'
        : errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  const chosen = activities.filter((entry) => activityIds.includes(entry.binding.activity_id));
  return (
    <section className="ach-course-preview" aria-labelledby="exercise-book-assign-title">
      <div className="acx-section-head"><h2 id="exercise-book-assign-title">Giao sách bài tập · {catalog.inventory.unit_id}</h2></div>
      {lookupFailed && <div className="acd-warning" role="alert">Không tra cứu được danh sách học viên của lớp. Chưa thể giao bài; hãy tải lại trang.</div>}
      <fieldset disabled={busy || lookupFailed}>
        <legend>Activity</legend>
        {activities.map((entry) => {
          const id = entry.binding.activity_id;
          const reasonId = `exercise-book-locked-${id}`;
          return (
            <label key={id} style={{ display: 'block', minHeight: 44 }}>
              <input type="checkbox" disabled={!entry.selectable} checked={activityIds.includes(id)}
                aria-describedby={entry.selectable ? undefined : reasonId} onChange={() => toggle(activityIds, id, setActivityIds)} />
              {' '}{id.replace(/^U\d+-/, '')} · {entry.title}
              {!entry.selectable && <span id={reasonId}> · Chưa mở: {readinessText(entry.readiness_reasons)}</span>}
            </label>
          );
        })}
      </fieldset>
      <fieldset disabled={busy || lookupFailed}>
        <legend>Học viên nhận bài ({recipientIds.length}/{recipients.length})</legend>
        {!lookupFailed && !recipients.length && <p>Lớp chưa có học viên đủ điều kiện nhận bài.</p>}
        {recipients.length > 0 && (
          <div className="ach-section-actions">
            <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setRecipientIds(recipients.map((entry) => entry.student_id))}>Chọn cả lớp</button>
            <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setRecipientIds([])}>Bỏ chọn tất cả</button>
          </div>
        )}
        <div className="ach-recipient-list">
          {recipients.map((entry) => (
            <label key={entry.student_id} style={{ display: 'block', minHeight: 44 }}>
              <input type="checkbox" checked={recipientIds.includes(entry.student_id)} onChange={() => toggle(recipientIds, entry.student_id, setRecipientIds)} />
              {' '}{entry.display_name}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Hạn nộp (giờ Việt Nam)" hint="Quá hạn thì học viên không mở, lưu hay nộp được nữa.">
        <input type="datetime-local" value={dueLocal} disabled={busy || lookupFailed} onChange={(event) => setDueLocal(event.target.value)} />
      </Field>
      {problem && <p className="acd-field-error" role="alert">{problem}</p>}
      {error && !confirming && <p role="alert">{error}</p>}
      <button className="adm-btn-primary" type="button" disabled={busy || lookupFailed} onClick={review}>Xem lại và giao bài</button>
      <Dialog open={confirming} title="Xác nhận giao bài" busy={busy} onClose={() => setConfirming(false)}
        description={<>Kiểm tra đúng activity, người nhận và hạn nộp trước khi giao.</>}
        actions={(
          <>
            <button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setConfirming(false)}>Quay lại</button>
            <button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void create()}>{busy ? 'Đang giao…' : 'Giao bài'}</button>
          </>
        )}>
        <p>{chosen.length} activity: {chosen.map((entry) => entry.binding.activity_id.replace(/^U\d+-/, '')).join(', ')}</p>
        <p>{recipientIds.length} học viên: {recipientIds.map((id) => names.get(id) || 'Học viên').join(', ')}</p>
        <p>Hạn nộp: {formatVnTime(vnLocalToIso(dueLocal))}</p>
        {error && <p role="alert">{error}</p>}
      </Dialog>
    </section>
  );
}

function AssignmentPanel({ cohortId, assignmentId, catalog, onArchived }: {
  cohortId: string;
  assignmentId: string;
  catalog: SourceCatalog;
  onArchived: () => void;
}) {
  const api = useExerciseBookApi();
  const [receipt, setReceipt] = useState<AssignmentReceipt | null>(null);
  const [progress, setProgress] = useState<AssignmentProgress | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ cell: ProgressCell; value: ActivityReview | null; error: string } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [reason, setReason] = useState('');
  const [archiveError, setArchiveError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [nextReceipt, nextProgress] = await Promise.all([api.getAssignment(cohortId, assignmentId), api.getProgress(cohortId, assignmentId)]);
      setReceipt(nextReceipt);
      setProgress(nextProgress);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }, [api, cohortId, assignmentId]);

  useEffect(() => { void load(); }, [load]);

  async function openReview(cell: ProgressCell) {
    setReview({ cell, value: null, error: '' });
    try {
      const value = await api.getTeacherReview(cohortId, assignmentId, cell.item_id, cell.activity_id);
      setReview({ cell, value, error: '' });
    } catch (caught) {
      setReview({ cell, value: null, error: errorText(caught) });
    }
  }

  async function archive() {
    const text = reason.trim();
    if (!text || text.length > 500) { setArchiveError('Nhập lý do đóng bài (1–500 ký tự).'); return; }
    setBusy(true);
    setArchiveError('');
    try {
      await api.archiveAssignment(cohortId, assignmentId, { status: 'archived', reason: text });
      setArchiving(false);
      setReason('');
      onArchived();
      await load();
    } catch (caught) {
      setArchiveError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  const names = useMemo(() => new Map((progress?.students || []).map((entry) => [entry.student_id, entry.display_name])), [progress]);
  const cells = useMemo(() => new Map((progress?.cells || []).map((cell) => [`${cell.student_id}|${cell.activity_id}`, cell])), [progress]);
  const activities = useMemo(() => [...(progress?.activities || [])].sort((left, right) => left.position - right.position), [progress]);
  const reviewLabels = useMemo(() => {
    if (!review) return undefined;
    const activity = catalog.inventory.activities.find((entry) => entry.binding.activity_id === review.cell.activity_id);
    return activity ? labelsFor(activity.items) : undefined;
  }, [catalog, review]);

  return (
    <section className="ach-progress" aria-labelledby="exercise-book-progress-title">
      <div className="acx-section-head">
        <h2 id="exercise-book-progress-title">Tiến độ bài giao</h2>
        <div className="ach-section-actions">
          <button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Đang tải…' : 'Tải lại tiến độ'}</button>
          {receipt?.status === 'published' && (
            <button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => { setArchiving(true); setArchiveError(''); }}>Đóng bài giao</button>
          )}
        </div>
      </div>
      {error && <div className="acd-warning" role="alert">{error}</div>}
      {receipt && (
        <dl className="acx-meta">
          <dt>Biên nhận</dt><dd>{receipt.status === 'published' ? 'Đang mở' : 'Đã đóng'} · tạo lúc {formatVnTime(receipt.created_at)}</dd>
          <dt>Hạn nộp</dt><dd>{formatVnTime(receipt.due_at)}</dd>
          <dt>Activity</dt><dd>{receipt.activities.map((entry) => entry.activity_id.replace(/^U\d+-/, '')).join(', ')}</dd>
          <dt>Người nhận</dt><dd>{receipt.recipient_ids.length} học viên</dd>
          <dt>Mẫu số hoàn thành</dt><dd>{receipt.completion_denominator} activity (không tính activity khóa)</dd>
        </dl>
      )}
      {progress && (
        <div className="acd-table-scroll" role="region" tabIndex={0} aria-label="Ma trận tiến độ học viên × activity">
          <table className="acd-table">
            <thead>
              <tr>
                <th scope="col">Học viên</th>
                <th scope="col">Hoàn thành</th>
                {activities.map((activity) => <th scope="col" key={activity.activity_key}>{activity.activity_key.replace(/^U\d+-/, '')}</th>)}
                <th scope="col">Chính tả</th>
              </tr>
            </thead>
            <tbody>
              {progress.students.map((student) => (
                <tr key={student.student_id}>
                  <th scope="row" style={{ position: 'sticky', left: 0, background: 'var(--av-surface, Canvas)' }}>{student.display_name}</th>
                  <td>{progress.completion.submitted_by_student[student.student_id] ?? 0}/{progress.completion.denominator}</td>
                  {activities.map((activity) => {
                    const cell = cells.get(`${student.student_id}|${activity.activity_key}`);
                    if (!cell) return <td key={activity.activity_key}>—</td>;
                    return (
                      <td key={activity.activity_key}>
                        <span>{CELL_STATUS_LABEL[cell.status]}</span>
                        {cell.submitted_at && <><br /><small>{formatVnTime(cell.submitted_at)}</small></>}
                        {cell.blank_count != null && <><br /><small>{cell.blank_count} ô trống</small></>}
                        {cell.status === 'submitted' && (
                          <><br /><button className="adm-btn-secondary adm-btn-sm" type="button"
                            aria-label={`Xem chữa bài ${activity.activity_key} của ${names.get(cell.student_id) || 'học viên'}`}
                            onClick={() => void openReview(cell)}>Xem chữa bài</button></>
                        )}
                      </td>
                    );
                  })}
                  <td>{progress.dictation.available ? 'Đã mở' : 'Chưa mở (phát hành riêng)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {review && (
        <section aria-label="Chữa bài của học viên">
          <h3>Chữa bài · {names.get(review.cell.student_id) || 'Học viên'} · {review.cell.activity_id}</h3>
          {review.error && <p role="alert">{review.error}</p>}
          {!review.error && !review.value && <p role="status">Đang tải chữa bài…</p>}
          {review.value && <ExerciseBookReview review={review.value} labels={reviewLabels} heading="Chữa bài" />}
          <button className="adm-btn-secondary" type="button" onClick={() => setReview(null)}>Đóng phần chữa bài</button>
        </section>
      )}
      <Dialog open={archiving} title="Đóng bài giao" busy={busy} onClose={() => setArchiving(false)}
        description="Học viên sẽ không mở được bài này nữa. Bài đã nộp và lịch sử vẫn được giữ."
        actions={(
          <>
            <button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setArchiving(false)}>Huỷ</button>
            <button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void archive()}>{busy ? 'Đang đóng…' : 'Đóng bài giao'}</button>
          </>
        )}>
        <Field label="Lý do (bắt buộc, ghi vào nhật ký lớp)">
          <textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {archiveError && <p role="alert">{archiveError}</p>}
      </Dialog>
    </section>
  );
}
