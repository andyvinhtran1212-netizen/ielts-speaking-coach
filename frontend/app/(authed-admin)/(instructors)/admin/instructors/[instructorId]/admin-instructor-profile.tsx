'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  formatInstructorCost,
  formatInstructorCount,
  formatMaybeCount,
  formatReviewHours,
  instructorLabel,
  instructorWorkspaceHref,
  normalizeCohortChoices,
  normalizeInstructorProfile,
  removeTeacherSummary,
} from '@/lib/admin-instructors-model.mjs';

import type { CohortChoice, InstructorMetric, TeacherClass } from '../admin-instructors-types';

type Pending =
  | { kind: 'remove'; cls: TeacherClass }
  | { kind: 'move'; choice: CohortChoice };

type ApiError = Error & { status?: number };

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'lỗi không xác định');
}

function classHref(id: string) {
  return `/admin/classes/${encodeURIComponent(id)}`;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="ain-metric"><dt>{label}</dt><dd>{value}</dd>{note && <small>{note}</small>}</div>;
}

/**
 * One teacher's profile (ADMINIA-0074 FR-106, sheet AdminGiaoVienThongBao):
 * the classes they teach (from `cohorts.instructor_id`), "Gỡ khỏi lớp…",
 * "Chuyển lớp sang giáo viên này" and the 30-day review volume. Every change
 * goes through `PATCH /admin/cohorts/{id}` and is followed by a refetch, so
 * the page always shows what a reload would.
 */
export function AdminInstructorProfile({ instructorId }: { instructorId: string }) {
  const admin = useAdminProfile();
  const [profile, setProfile] = useState<InstructorMetric | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [choices, setChoices] = useState<CohortChoice[] | null>(null);
  const [choicesError, setChoicesError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sequence = useRef(0);
  const selectId = useId();

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true);
    setLoadError(null);
    const path = `/admin/instructors/${encodeURIComponent(instructorId)}`;
    const [profileResult, cohortResult] = await Promise.allSettled([
      window.api.get<unknown>(path),
      window.api.get<unknown>('/admin/cohorts?is_active=true'),
    ]);
    if (requestId !== sequence.current) return;
    if (profileResult.status === 'fulfilled') {
      const normalized = normalizeInstructorProfile(profileResult.value) as InstructorMetric | null;
      if (normalized) { setProfile(normalized); setMissing(false); }
      else setLoadError('Dữ liệu giảng viên không đúng định dạng.');
    } else if ((profileResult.reason as ApiError)?.status === 404) {
      setMissing(true);
      setProfile(null);
    } else {
      setLoadError(messageOf(profileResult.reason));
    }
    if (cohortResult.status === 'fulfilled') {
      const normalized = normalizeCohortChoices(cohortResult.value) as CohortChoice[] | null;
      setChoices(normalized);
      setChoicesError(normalized ? null : 'Danh sách lớp không đúng định dạng.');
    } else {
      setChoicesError(messageOf(cohortResult.reason));
    }
    setLoading(false);
  }, [instructorId]);

  useEffect(() => {
    setProfile(null);
    void load();
    return () => { sequence.current += 1; };
  }, [admin.id, load]);

  const label = profile ? instructorLabel(profile) : 'giảng viên';
  const movable = useMemo(
    () => (choices || []).filter((c) => c.teacherId !== instructorId),
    [choices, instructorId],
  );
  const picked = movable.find((c) => c.id === pick) || null;

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    const cohortId = pending.kind === 'remove' ? pending.cls.id : pending.choice.id;
    const className = pending.kind === 'remove' ? pending.cls.name : pending.choice.name;
    try {
      await window.api.patch(`/admin/cohorts/${encodeURIComponent(cohortId)}`, {
        instructor_id: pending.kind === 'remove' ? null : instructorId,
      });
      setDone(pending.kind === 'remove'
        ? `Đã gỡ ${label} khỏi lớp ${className}. Lớp hiện chưa có giáo viên.`
        : `Đã chuyển lớp ${className} sang ${label}.`);
      setPending(null);
      setPick('');
    } catch (caught) {
      setActionError(messageOf(caught));
    } finally {
      setBusy(false);
      void load();
    }
  };

  if (missing) {
    return (
      <main className="ain-shell">
        <a className="ain-back" href="/admin/instructors">← Giảng viên</a>
        <div className="ain-state is-empty" role="status"><strong>Không tìm thấy giảng viên</strong><span>Tài khoản này không có vai trò giảng viên.</span></div>
      </main>
    );
  }

  const workspace = instructorWorkspaceHref(instructorId);
  const speed = profile ? formatReviewHours(profile.avgReviewHours) : '';

  return (
    <main className="ain-shell">
      <a className="ain-back" href="/admin/instructors">← Giảng viên</a>
      <header className="ain-header">
        <div>
          <p className="ain-eyebrow">Hồ sơ giảng viên</p>
          <h1>{profile ? label : 'Đang mở hồ sơ…'}</h1>
          {profile?.displayName && profile.email && <p className="ain-subtitle">{profile.email}</p>}
        </div>
        <div className="ain-header__actions">
          {workspace && <a className="btn-secondary" href={workspace} aria-label={`Xem như giáo viên ${label} (có ghi audit)`}>Xem như giáo viên</a>}
          <button className="btn-secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Đang làm mới…' : 'Làm mới'}</button>
        </div>
      </header>

      {loadError && <div className="ain-banner is-error" role="alert"><div><strong>{profile ? 'Không thể làm mới — đang giữ dữ liệu cũ.' : 'Không tải được hồ sơ giảng viên.'}</strong><span>{loadError}</span></div><button className="btn-secondary" type="button" disabled={loading} onClick={() => void load()}>Thử lại</button></div>}
      {done && <div className="ain-banner is-ok" role="status">{done}</div>}
      {actionError && !pending && <div className="ain-banner is-error" role="alert"><div><strong>Không lưu được thay đổi.</strong><span>{actionError}</span></div></div>}
      {loading && !profile && !loadError && <div className="ain-state" role="status">Đang mở hồ sơ giảng viên…</div>}

      {profile && <>
        <section className="ain-panel" aria-labelledby="ain-classes-title" aria-busy={loading}>
          <div className="ain-panel__head"><h2 id="ain-classes-title">Lớp được gán</h2><p>Mỗi lớp có nhiều nhất một giáo viên.</p></div>
          {profile.classes == null
            ? <div className="ain-state" role="status">Chưa đọc được danh sách lớp của giảng viên này.</div>
            : profile.classes.length === 0
              ? <div className="ain-state is-empty"><strong>Chưa phụ trách lớp nào</strong><span>Chọn một lớp ở “Gán lớp” bên dưới.</span></div>
              : <div className="ain-table-wrap"><table className="ain-table">
                  <thead><tr><th scope="col">Lớp</th><th scope="col">Writing chờ duyệt</th><th scope="col">Quá hạn</th><th scope="col">Speaking thi thử chờ chấm</th><th scope="col"><span className="ain-sr">Thao tác</span></th></tr></thead>
                  <tbody>{profile.classes.map((cls) => (
                    <tr key={cls.id}>
                      <th scope="row" data-label="Lớp"><a href={classHref(cls.id)}>{cls.name}</a></th>
                      <td data-label="Writing chờ duyệt"><span className="ain-num">{formatMaybeCount(cls.writingPending)}</span></td>
                      <td data-label="Quá hạn"><span className="ain-num">{formatMaybeCount(cls.writingOverdue)}</span></td>
                      <td data-label="Speaking thi thử chờ chấm"><span className="ain-muted">{formatMaybeCount(cls.speakingMockPending)}</span></td>
                      <td className="ain-actions" data-label="Thao tác">
                        <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setDone(null); setActionError(null); setPending({ kind: 'remove', cls }); }}>Gỡ khỏi lớp…</button>
                      </td>
                    </tr>
                  ))}</tbody>
                </table></div>}
        </section>

        <section className="ain-panel" aria-labelledby="ain-assign-title">
          <div className="ain-panel__head"><h2 id="ain-assign-title">Gán lớp</h2><p>Lớp đang có giáo viên khác sẽ đổi thẳng sang {label}; người cũ mất quyền với lớp đó.</p></div>
          {choicesError
            ? <div className="ain-banner is-error" role="alert"><div><strong>Không tải được danh sách lớp.</strong><span>{choicesError}</span></div></div>
            : choices == null
              ? <div className="ain-state" role="status">Đang tải danh sách lớp…</div>
              : movable.length === 0
                ? <div className="ain-state is-empty"><strong>Không còn lớp nào để gán</strong><span>Mọi lớp đang mở đều do {label} phụ trách.</span></div>
                : <div className="ain-assign">
                    <div className="ain-select">
                      <label htmlFor={selectId}>Lớp</label>
                      <select id={selectId} value={pick} onChange={(event) => setPick(event.target.value)}>
                        <option value="">Chọn lớp…</option>
                        {movable.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.teacherId ? `${c.name} · đang do ${c.teacherName || 'giáo viên khác'} dạy` : `${c.name} · chưa có giáo viên`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="button" className="btn-primary" disabled={!picked || busy} onClick={() => { if (picked) { setDone(null); setActionError(null); setPending({ kind: 'move', choice: picked }); } }}>Chuyển lớp sang giáo viên này</button>
                  </div>}
        </section>

        <section className="ain-panel" aria-labelledby="ain-volume-title">
          <div className="ain-panel__head"><h2 id="ain-volume-title">Khối lượng duyệt · 30 ngày</h2></div>
          <dl className="ain-metrics ain-metrics--wide">
            <Stat label="Đã duyệt và trả" value={formatMaybeCount(profile.delivered30d)} />
            <Stat label="Đang chờ duyệt" value={formatMaybeCount(profile.writingPending)} note="Ở các lớp đang phụ trách" />
            <Stat label="Quá hạn xử lý" value={formatMaybeCount(profile.writingOverdue)} note="Chưa trả, đã qua hạn nộp" />
            <Stat label="Đang duyệt dở" value={formatMaybeCount(profile.inProgress)} />
            <Stat label="Thời gian duyệt trung bình" value={speed || '—'} note={speed ? 'Từ lúc AI chấm xong tới lúc trả bài' : 'Chưa đủ 5 bài trả trong 30 ngày'} />
          </dl>
        </section>

        <section className="ain-panel" aria-labelledby="ain-writing-title">
          <div className="ain-panel__head"><h2 id="ain-writing-title">Writing theo học viên được gắn</h2><p>Phạm vi sở hữu Writing (học viên gắn với giảng viên và bài họ giao), tính từ trước tới nay.</p></div>
          <dl className="ain-metrics ain-metrics--wide">
            <Stat label="Học viên thuộc GV" value={formatInstructorCount(profile.students)} />
            <Stat label="Đề tự soạn" value={formatInstructorCount(profile.prompts)} />
            <Stat label="Bài đã trả" value={formatInstructorCount(profile.graded)} />
            <Stat label="Bài từng chấm lại" value={formatInstructorCount(profile.regraded)} note="Bởi bất kỳ người chấm nào" />
            <Stat label="Tổng lượt chấm lại" value={formatInstructorCount(profile.regradeEvents)} />
            <Stat label="Chi phí ước tính" value={formatInstructorCost(profile.costUsd)} note={`${formatInstructorCount(profile.tokens)} token · USD`} />
          </dl>
        </section>
      </>}

      <Dialog
        open={pending != null}
        busy={busy}
        panelClassName="ain-dialog"
        backdropClassName="ain-dialog-backdrop"
        title={pending?.kind === 'remove'
          ? `Gỡ ${label} khỏi lớp ${pending.cls.name}?`
          : pending?.kind === 'move'
            ? `Chuyển lớp ${pending.choice.name} sang ${label}?`
            : ''}
        description={pending?.kind === 'remove'
          ? removeTeacherSummary(pending.cls)
          : pending?.kind === 'move'
            ? (pending.choice.teacherId
              ? `${pending.choice.teacherName || 'Giáo viên hiện tại'} sẽ không còn là giáo viên của lớp này và mất quyền với lớp ngay.`
              : 'Lớp đang chưa có giáo viên.')
            : null}
        onClose={() => { if (!busy) { setPending(null); setActionError(null); } }}
        actions={<>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setPending(null); setActionError(null); }}>Huỷ</button>
          <button type="button" className="ain-danger" disabled={busy} onClick={() => void confirm()}>
            {busy
              ? (pending?.kind === 'remove' ? 'Đang gỡ…' : 'Đang chuyển…')
              : (pending?.kind === 'remove' ? 'Gỡ khỏi lớp' : 'Chuyển lớp')}
          </button>
        </>}
      >
        {actionError && <p className="ain-dialog-error" role="alert">{actionError}</p>}
      </Dialog>
    </main>
  );
}
