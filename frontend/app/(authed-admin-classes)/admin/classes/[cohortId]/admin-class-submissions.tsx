'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Dialog, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import { canReturnSubmission, groupReportQuestions, normalizeEffort, normalizeStudentReport, normalizeTally, normalizeWriting } from '@/lib/admin-class-submissions-model.mjs';

import type { Banner } from './admin-class-detail-types';
import type { EffortPayload, StudentReport, SubmissionWorkspaceProps, TallyPayload, TallyStudent, WritingPayload } from './admin-class-submissions-types';

type View = 'tally' | 'effort' | 'student';
const STATUS = { 'no-account': 'Chưa kích hoạt', missing: 'Không nộp', pending: 'Chưa nộp', late: 'Nộp trễ', submitted: 'Đã nộp' } as Record<string, string>;
const EFFORT = { stalled: 'Bỏ dở', awaiting_writing: 'Chưa nộp tự luận', doing: 'Đang làm', done: 'Xong', untouched: 'Chưa mở' } as Record<string, string>;
const NEXT = { passed: 'Đã đạt', retake: 'Revision ngắn', retry_full: 'Làm lại toàn bộ' } as Record<string, string>;
const ISSUE_KIND = { grammar: 'ngữ pháp', spelling: 'chính tả', mechanics: 'hình thức' } as Record<string, string>;

function formatVietnam(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Không rõ' : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function openArtifact(row: TallyStudent) {
  if (row.artifact_kind === 'session' && row.artifact_id) return `/pages/admin/speaking/sessions.html?session=${encodeURIComponent(row.artifact_id)}`;
  return null;
}

function InlineMd({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <mark key={index}>{part.slice(2, -2)}</mark> : <span key={index}>{part}</span>)}</>;
}

function Report({ report }: { report: StudentReport }) {
  const [openAxis, setOpenAxis] = useState<string | null>(null);
  const groups = useMemo(() => groupReportQuestions(report.questions) as { axis: string; items: StudentReport['questions']; wrong: number; total: number; rate: number }[], [report.questions]);
  const weak = groups.filter((group) => group.total >= 2 && group.rate >= 0.5);
  if (report.stale && !groups.length) return <div className="acd-warning" role="alert">Chưa đọc được bài làm chi tiết; chưa thể kết luận học viên đúng, sai hay chưa có bài.</div>;
  return <div className="acs-report">
    {report.stale && <div className="acd-warning" role="alert">Chưa đọc được đầy đủ bài làm; vài câu hoặc lịch sử có thể còn thiếu.</div>}
    <div className="acs-report-hero"><div><span>Trục cần ôn nhất</span><strong>{weak[0]?.axis || 'Không có trục yếu nổi bật'}</strong></div><div><b>{weak.length}</b><span>trục cần ôn</span></div></div>
    <dl className="acs-report-stats"><div><dt>Đúng</dt><dd>{report.totals.correct}/{report.totals.answered}</dd></div><div><dt>Giây/câu</dt><dd>{report.totals.median_sec ?? '—'}</dd></div><div><dt>Làm bài</dt><dd>{report.totals.active_sec == null ? '—' : `${Math.round(report.totals.active_sec / 60)} phút`}</dd></div>{Boolean(report.totals.idle_sec) && <div><dt>Rời máy</dt><dd>≈ {Math.round((report.totals.idle_sec || 0) / 60)} phút</dd></div>}</dl>
    {report.history.length > 0 && <section className="acs-history"><div><p className="acd-eyebrow">Learning trail</p><h4>Session & revision</h4><span>Chỉ gồm lượt hệ thống đã chấm và ghi vào tiến độ.</span></div><div className="acd-table-scroll" tabIndex={0}><table className="acd-table"><thead><tr><th>Lượt</th><th>Hình thức</th><th>Session</th><th>Kết quả</th><th>Bước tiếp</th><th>Thời gian</th></tr></thead><tbody>{report.history.map((row) => <tr key={`${row.number}-${row.at}`}><td>#{row.number}</td><td>{row.phase === 'retake' ? 'Revision' : 'Full session'}</td><td>{row.session_count}</td><td>{row.pct == null ? '—' : `${row.pct}%`}</td><td>{NEXT[row.next_action] || 'Đã ghi nhận'}</td><td>{formatVietnam(row.at)}</td></tr>)}</tbody></table></div></section>}
    {report.locked && <div className="acd-warning">Chi tiết từng câu chỉ mở cho học viên sau khi đạt {report.threshold ?? 'ngưỡng lớp'}%; admin vẫn đang đọc dữ liệu đã được backend cấp theo quyền chấm.</div>}
    {!groups.length ? <p className="acd-muted">Chưa có câu nào được chấm.</p> : <div className="acs-axes">{groups.map((group) => <section key={group.axis} className={group.rate >= 0.5 && group.total >= 2 ? 'is-weak' : ''}><button type="button" onClick={() => setOpenAxis(openAxis === group.axis ? null : group.axis)} aria-expanded={openAxis === group.axis}><span>{group.axis}</span><strong>{group.wrong}/{group.total} sai</strong></button>{openAxis === group.axis && <div>{group.items.map((question, index) => <article key={question.qid || index} className={question.is_correct ? '' : 'is-wrong'}><p><InlineMd text={question.prompt || 'Không đọc được đề bài'} /></p><dl><dt>Em chọn</dt><dd>{question.picked == null ? '' : `${String.fromCharCode(65 + question.picked)}. `}{question.picked_text || 'Không trả lời'}</dd>{!question.is_correct && <><dt>Đáp án</dt><dd>{question.answer == null ? '' : `${String.fromCharCode(65 + question.answer)}. `}{question.answer_text || '—'}</dd></>}</dl>{question.why_wrong && <p className="acs-why">{question.why_wrong}</p>}{question.explain && <p>{question.explain}</p>}{question.seconds != null && <small>{question.seconds} giây</small>}</article>)}</div>}</section>)}</div>}
  </div>;
}

function WritingReport({ data }: { data: WritingPayload }) {
  const submission = data.submission;
  if (!submission) return <p className="acd-muted">Học viên này chưa nộp phần tự luận.</p>;
  return <div className="acs-writing"><div className="acs-writing-score"><strong>{submission.clean}</strong><span>/ {submission.total} câu đúng ngữ pháp</span></div><p className="acd-muted">Chấm lúc {formatVietnam(submission.graded_at)}{submission.model ? ` · ${submission.model}` : ''}. Máy soát ngữ pháp và chính tả, không sửa cách viết.</p>{submission.items.map((item, index) => { const issues = Array.isArray(item.issues) ? item.issues as Record<string, unknown>[] : []; const prompt = String(item.prompt ?? ''); const answer = String(item.answer ?? ''); const corrected = item.corrected == null ? '' : String(item.corrected); const explain = item.explain == null ? '' : String(item.explain); const ok = item.ok; const formOnly = ok === true && issues.length > 0; const graderError = item.error == null ? '' : String(item.error); return <article key={index} data-ok={ok == null ? 'unknown' : String(ok)} data-form={formOnly || undefined}><b>Câu {index + 1}</b><p><InlineMd text={prompt} /></p><blockquote>{answer}</blockquote>{ok == null ? <p className="acs-writing-unknown">{graderError || 'Chưa chấm được câu này.'}</p> : <>{corrected && corrected !== answer && <p><strong>Bản sửa:</strong> {corrected}</p>}{formOnly && <p className="acs-writing-unknown">Đúng ngữ pháp, còn lỗi trình bày — tính là đúng.</p>}{ok === true && !formOnly && <p className="acd-muted">Không có lỗi ngữ pháp hay chính tả.</p>}{issues.length > 0 && <ul>{issues.map((issue, issueIndex) => { const note = issue.note == null ? '' : String(issue.note); const type = String(issue.type ?? ''); return <li key={issueIndex}><span>{ISSUE_KIND[type] || type || 'lỗi'}</span><span>{String(issue.before ?? '')} → <strong>{String(issue.after ?? '')}</strong>{note ? ` · ${note}` : ''}</span></li>; })}</ul>}</>}{explain && <p><InlineMd text={explain} /></p>}</article>; })}</div>;
}

export function AdminClassSubmissions({ cohortId, assignment, memberNames, memberUserIds, memberNamesAvailable, onBack, onMutation }: SubmissionWorkspaceProps) {
  const [view, setView] = useState<View>('tally');
  const [tally, setTally] = useState<TallyPayload | null>(null);
  const [effort, setEffort] = useState<EffortPayload | null>(null);
  const [report, setReport] = useState<StudentReport | null>(null);
  const [writing, setWriting] = useState<WritingPayload | null>(null);
  const [selected, setSelected] = useState<{ studentId: string | null; userId: string | null; name: string; hasWriting: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [returning, setReturning] = useState<TallyStudent | null>(null);
  const sequence = useRef(0);
  const bankId = assignment.skill === 'course' ? assignment.content_id : null;
  const canReturnWork = canReturnSubmission(assignment.status, tally?.sealed);

  const loadTally = useCallback(async (silent = false) => {
    const requestId = ++sequence.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const normalized = normalizeTally(await window.api.get<unknown>(`/admin/cohorts/${encodeURIComponent(cohortId)}/assignments/${encodeURIComponent(assignment.id)}/tally`)) as TallyPayload | null;
      if (requestId !== sequence.current) return false;
      if (!normalized) throw new Error('Dữ liệu nhận bài không đúng định dạng.');
      setTally(normalized); setLoading(false); return true;
    } catch (caught) { if (requestId === sequence.current) { setError(messageOf(caught)); setLoading(false); } return false; }
  }, [assignment.id, cohortId]);

  useEffect(() => { setView('tally'); setTally(null); setEffort(null); setReport(null); setWriting(null); setSelected(null); setBanner(null); void loadTally(); return () => { sequence.current += 1; }; }, [assignment.id, loadTally]);

  const loadEffort = async (force = false) => {
    if (!bankId) return;
    const requestId = ++sequence.current;
    setView('effort'); setError(null); setLoading(false); if (effort && !force) return;
    setLoading(true); setError(null);
    try { const normalized = normalizeEffort(await window.api.get<unknown>(`/admin/quiz/banks/${encodeURIComponent(bankId)}/attempt-report?assignment_id=${encodeURIComponent(assignment.id)}`)) as EffortPayload | null; if (requestId !== sequence.current) return; if (!normalized) throw new Error('Dữ liệu chi tiết làm bài không đúng định dạng.'); setEffort(normalized); }
    catch (caught) { if (requestId === sequence.current) setError(messageOf(caught)); } finally { if (requestId === sequence.current) setLoading(false); }
  };

  const openStudent = async (row: { student_id: string | null; user_id?: string | null; name: string; has_writing: boolean }) => {
    const requestId = ++sequence.current;
    const failures: string[] = [];
    const initialUserId = row.user_id || (row.student_id ? memberUserIds[row.student_id] : null) || null;
    setView('student'); setSelected({ studentId: row.student_id, userId: initialUserId, name: row.name || 'Học viên', hasWriting: row.has_writing }); setReport(null); setWriting(null); setError(null); setLoading(true);
    if (row.has_writing && row.student_id) {
      try { const normalized = normalizeWriting(await window.api.get<unknown>(`/admin/cohorts/${encodeURIComponent(cohortId)}/assignments/${encodeURIComponent(assignment.id)}/writing/${encodeURIComponent(row.student_id)}`)) as WritingPayload | null; if (requestId !== sequence.current) return; if (!normalized) throw new Error('Dữ liệu tự luận không đúng định dạng.'); setWriting(normalized); }
      catch (caught) { failures.push(`Không đọc được phần tự luận: ${messageOf(caught)}`); }
    }
    if (bankId) {
      let data = effort;
      if (!data) {
        try { const normalized = normalizeEffort(await window.api.get<unknown>(`/admin/quiz/banks/${encodeURIComponent(bankId)}/attempt-report?assignment_id=${encodeURIComponent(assignment.id)}`)) as EffortPayload | null; if (requestId !== sequence.current) return; if (!normalized) throw new Error('Dữ liệu chi tiết làm bài không đúng định dạng.'); data = normalized; setEffort(normalized); }
        catch (caught) { failures.push(`Không đọc được bảng tiến độ: ${messageOf(caught)}`); }
      }
      const effortRow = data?.students.find((item) => row.student_id ? item.student_id === row.student_id : item.user_id === initialUserId);
      const userId = effortRow?.user_id || initialUserId;
      setSelected({ studentId: row.student_id, userId, name: row.name || (row.student_id ? memberNames[row.student_id] : '') || 'Học viên đã rời lớp', hasWriting: row.has_writing });
      if (userId) {
        try { const normalized = normalizeStudentReport(await window.api.get<unknown>(`/admin/quiz/banks/${encodeURIComponent(bankId)}/students/${encodeURIComponent(userId)}/report?assignment_id=${encodeURIComponent(assignment.id)}`)) as StudentReport | null; if (requestId !== sequence.current) return; if (!normalized) throw new Error('Báo cáo từng câu không đúng định dạng.'); setReport(normalized); }
        catch (caught) { failures.push(`Không đọc được bài từng câu: ${messageOf(caught)}`); }
      }
    }
    if (requestId === sequence.current) { setError(failures.length ? failures.join(' ') : null); setLoading(false); }
  };

  const retryCurrent = () => {
    if (view === 'tally') return void loadTally();
    if (view === 'effort') return void loadEffort();
    if (selected) void openStudent({ student_id: selected.studentId, user_id: selected.userId, name: selected.name, has_writing: selected.hasWriting });
  };

  const moveInnerTab = (event: KeyboardEvent<HTMLButtonElement>, current: View) => {
    const available: View[] = bankId ? ['tally', 'effort', 'student'] : ['tally', 'student'];
    const enabled = available.filter((item) => item !== 'student' || selected);
    const index = enabled.indexOf(current);
    let next: View | null = null;
    if (event.key === 'ArrowRight') next = enabled[(index + 1) % enabled.length];
    if (event.key === 'ArrowLeft') next = enabled[(index - 1 + enabled.length) % enabled.length];
    if (event.key === 'Home') next = enabled[0];
    if (event.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    if (next === 'effort') void loadEffort();
    else { sequence.current += 1; setLoading(false); setError(null); setView(next); }
    window.requestAnimationFrame(() => document.getElementById(`acs-tab-${next}`)?.focus());
  };

  const returnWork = async () => {
    if (!returning) return;
    if (!canReturnWork) {
      setReturning(null);
      setBanner({ kind: 'error', text: assignment.status !== 'published' ? 'Mở lại bài giao trước khi trả bài cho học viên.' : 'Dời hạn nộp trước khi trả bài cho học viên.' });
      return;
    }
    const row = returning; setReturning(null); setLoading(true); setBanner(null);
    try {
      const result = await window.api.post<{ draft_restored?: number; audit_logged?: boolean }>(`/admin/cohorts/${encodeURIComponent(cohortId)}/assignments/${encodeURIComponent(assignment.id)}/return/${encodeURIComponent(row.student_id)}`, {});
      const canonical = await loadTally(true); await onMutation(); setView('tally'); setSelected(null); setWriting(null); setReport(null); setEffort(null);
      const restored = Number(result?.draft_restored || 0);
      setBanner(canonical ? { kind: restored ? 'success' : 'error', text: restored ? `Đã trả bài. ${restored} câu đã được đưa lại vào ô nhập của học viên.` : 'Đã trả bài nhưng không khôi phục được câu nào; học viên phải viết lại.' } : { kind: 'error', text: 'Đã trả bài nhưng chưa đọc lại được sổ chuẩn.' });
      if (result?.audit_logged === false) setBanner({ kind: 'error', text: 'Đã trả bài nhưng không ghi được nhật ký thao tác.' });
    } catch (caught) { setBanner({ kind: 'error', text: `Chưa trả được bài: ${messageOf(caught)}` }); } finally { setLoading(false); }
  };

  return <section id="acx-panel-homework" className="acd-workspace acs-workspace" role="tabpanel" aria-labelledby="acx-tab-homework">
    <button className="adm-btn-link acs-back" type="button" onClick={onBack}>← Quay lại danh sách bài tập</button>
    <header className="acx-section-head"><div><p className="acd-eyebrow">Không gian nhận & chấm bài</p><h2>{assignment.title}</h2><p>{assignment.skill === 'course' ? 'Đọc tình trạng, mức độ làm bài, từng câu và phần tự luận từ các sổ chuẩn.' : 'Đọc tình trạng từng học viên và mở đúng bài làm đã nộp.'}</p></div><button className="adm-btn-secondary" type="button" onClick={() => view === 'effort' ? void loadEffort(true) : view === 'student' ? retryCurrent() : void loadTally()} disabled={loading}>Tải lại</button></header>
    <StatusBanner banner={banner} />
    <nav className="acs-tabs" role="tablist" aria-label="Cách xem bài nộp"><button id="acs-tab-tally" type="button" role="tab" aria-controls={view === 'tally' && !loading && !error ? 'acs-panel-tally' : undefined} aria-selected={view === 'tally'} tabIndex={view === 'tally' ? 0 : -1} className={view === 'tally' ? 'is-active' : ''} onKeyDown={(event) => moveInnerTab(event, 'tally')} onClick={() => { sequence.current += 1; setLoading(false); setError(null); setView('tally'); }}>Ai nộp</button>{bankId && <button id="acs-tab-effort" type="button" role="tab" aria-controls={view === 'effort' && !loading && !error ? 'acs-panel-effort' : undefined} aria-selected={view === 'effort'} tabIndex={view === 'effort' ? 0 : -1} className={view === 'effort' ? 'is-active' : ''} onKeyDown={(event) => moveInnerTab(event, 'effort')} onClick={() => void loadEffort()}>Chi tiết làm bài</button>}<button id="acs-tab-student" type="button" role="tab" aria-controls={view === 'student' && !loading && selected ? 'acs-panel-student' : undefined} aria-selected={view === 'student'} tabIndex={view === 'student' ? 0 : -1} className={view === 'student' ? 'is-active' : ''} disabled={!selected} onKeyDown={(event) => moveInnerTab(event, 'student')} onClick={() => selected && setView('student')}>Bài từng em</button></nav>
    {error && view !== 'student' && <div className="acd-state is-error" role="alert"><strong>Không đọc được dữ liệu mới nhất</strong><span>{error}</span><button className="adm-btn-secondary" type="button" onClick={retryCurrent}>Thử lại</button></div>}
    {loading && !error && <div className="acd-state" role="status"><strong>Đang đối chiếu bài nộp…</strong><span>Hệ thống đang đọc các lượt làm và sổ bài giao chuẩn.</span></div>}
    {!loading && !error && view === 'tally' && tally && <div id="acs-panel-tally" role="tabpanel" aria-labelledby="acs-tab-tally" className="acs-tally"><div className="acs-summary"><div><strong>{tally.counts.submitted}</strong><span>/ {tally.counts.total} đã nộp</span>{tally.counts.flagged > 0 && <em>{tally.counts.flagged} bài cần xem lại</em>}</div><span className={`adm-status-pill ${canReturnWork ? 'is-active' : 'is-archived'}`}>{assignment.status !== 'published' ? 'Đã đóng bài' : tally.sealed ? 'Đã chốt' : 'Đang nhận bài'}</span></div>{tally.homework_stale && <div className="acd-warning">Chưa đối chiếu được một phần dữ liệu; các con số có thể còn thiếu.</div>}<div className="acs-tally-list">{tally.students.map((row) => { const href = openArtifact(row); const canInspect = Boolean(href || row.has_writing || (bankId && (row.artifact_id || memberUserIds[row.student_id]))); return <article key={row.student_id} data-status={row.status} className={row.flag_level ? 'has-flag' : ''}><i aria-hidden="true" /><div><strong>{row.name || row.student_code || 'Học viên đã rời lớp'}</strong><span>{STATUS[row.status] || row.status}{row.submitted_at ? ` · ${formatVietnam(row.submitted_at)}` : ''}</span>{row.flags.length > 0 && <ul>{row.flags.map((flag, index) => <li key={index}><strong>{flag.label}</strong><span>{flag.why}</span><em>{flag.action}</em></li>)}</ul>}</div><div className="acs-score">{row.score == null ? '—' : assignment.skill === 'course' ? <><strong>{Math.round(row.score)}%</strong><small>{row.passed_at ? 'Đã đạt' : row.verdicts ? 'Chưa đạt' : 'Đang làm'}{row.retakes ? ` · KTL×${row.retakes}` : ''}</small></> : row.score.toFixed(1)}</div><div className="acs-row-actions">{href && <a className="adm-btn-secondary adm-btn-sm" href={href} target="_blank" rel="noopener noreferrer">Nghe & xem</a>}{canInspect && !href && <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void openStudent({ student_id: row.student_id, name: row.name || row.student_code || 'Học viên', has_writing: row.has_writing })}>{row.has_writing ? 'Xem bài' : 'Xem từng câu'}</button>}{row.has_writing && canReturnWork && <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setReturning(row)} disabled={loading}>Trả bài</button>}{row.has_writing && !canReturnWork && <span>{assignment.status !== 'published' ? 'Mở lại bài trước khi trả bài' : 'Dời hạn trước khi trả bài'}</span>}{row.writing_expected && !row.has_writing && <span>Chưa nộp tự luận</span>}</div></article>; })}</div><p className="acd-muted">Hạn {formatVietnam(tally.assignment.due_at)}. {canReturnWork ? 'Danh sách còn thay đổi tới hạn.' : `${tally.counts.missing} học viên không nộp.`}{tally.counts.no_account ? ` ${tally.counts.no_account} học viên chưa kích hoạt.` : ''}</p></div>}
    {!loading && !error && view === 'effort' && effort && <div id="acs-panel-effort" role="tabpanel" aria-labelledby="acs-tab-effort" className="acs-effort">{effort.stale && <div className="acd-warning">Chưa đọc đủ dữ liệu bài làm; vài dòng có thể thiếu.</div>}{!effort.students.length ? <div className="acd-state"><strong>{effort.stale ? 'Chưa đọc được danh sách lượt làm' : 'Chưa có ai mở bài này'}</strong><span>{effort.stale ? 'Không kết luận đây là danh sách rỗng; hãy tải lại.' : 'Bảng sẽ xuất hiện khi học viên bắt đầu làm bài.'}</span></div> : <><div className="acd-table-scroll" tabIndex={0}><table className="acd-table"><thead><tr><th>Học viên</th><th>Tình trạng</th><th>Chặng</th>{effort.writing_total > 0 && <th>Tự luận</th>}<th>Thời gian</th><th>Đúng</th><th>Tỉ lệ</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{effort.students.map((row) => { const rosterHasStudent = row.student_id != null && Object.prototype.hasOwnProperty.call(memberNames, row.student_id); const name = row.student_id ? memberNames[row.student_id] || (memberNamesAvailable ? 'Học viên đã rời lớp' : 'Không đọc được tên học viên') : 'Học viên đã rời lớp'; const tallyRow = row.student_id ? tally?.students.find((item) => item.student_id === row.student_id) : null; const unactivated = row.student_id != null && memberNamesAvailable && rosterHasStudent && memberUserIds[row.student_id] == null; return <tr key={row.student_id || row.user_id}><td>{name}{unactivated && <small className="acs-account-note">Chưa kích hoạt</small>}</td><td><span className={`adm-status-pill ${row.state === 'done' ? 'is-active' : row.state === 'stalled' ? 'is-warning' : 'is-archived'}`}>{EFFORT[row.state] || row.state}</span></td><td>{row.stages_done}{effort.stages_total ? `/${effort.stages_total}` : ''}</td>{effort.writing_total > 0 && <td>{row.wrote ? 'Đã nộp' : '—'}</td>}<td>{row.minutes == null ? '—' : `${row.minutes}′`}</td><td>{row.questions ? `${row.correct}/${row.questions}` : '—'}</td><td>{row.accuracy == null ? '—' : `${Math.round(row.accuracy * 100)}%`}</td><td><button className="adm-btn-secondary adm-btn-sm" type="button" disabled={!row.user_id} onClick={() => void openStudent({ student_id: row.student_id, user_id: row.user_id, name, has_writing: tallyRow?.has_writing || row.wrote })}>Xem bài</button></td></tr>; })}</tbody></table></div><p className="acd-muted">Thời gian cộng từ các chặng đã chốt; không tính tab mở nhưng chưa hoàn thành.</p></>}{effort.axes.length > 0 && <section className="acs-class-axes"><h3>Cả lớp vướng ở đâu</h3>{effort.axes.map((axis) => <div key={axis.axis}><span>{axis.axis}</span><strong>{axis.wrong} sai</strong><em>{axis.median_sec == null ? '—' : `${axis.median_sec}s trung vị`}</em></div>)}</section>}</div>}
    {!loading && view === 'student' && selected && <div id="acs-panel-student" role="tabpanel" aria-labelledby="acs-tab-student" className="acs-student"><header><div><p className="acd-eyebrow">Bài từng em</p><h3>{selected.name}</h3></div><button className="adm-btn-secondary" type="button" onClick={() => setView('tally')}>Về bảng tổng kết</button></header>{error && <div className="acd-warning" role="alert">{error} Phần đã đọc được vẫn hiển thị bên dưới.<button className="adm-btn-secondary" type="button" onClick={retryCurrent}>Thử lại</button></div>}{writing && <WritingReport data={writing} />}{report && <Report report={report} />}{!writing && !report && <p className={effort?.stale ? 'acd-warning' : 'acd-muted'}>{effort?.stale ? 'Chưa đối chiếu được bài chi tiết từ dữ liệu hiện tại; hãy tải lại báo cáo.' : 'Chưa có bài chi tiết để đọc.'}</p>}</div>}
    <Dialog open={Boolean(returning)} title="Trả bài cho học viên làm lại?" description="Lượt nộp hiện tại không còn tính là đã nộp. Bài cũ và bản chấm vẫn được giữ; câu đã viết sẽ được khôi phục nếu còn bản nháp hợp lệ. Chỉ thực hiện được khi bài còn nhận nộp." busy={loading} onClose={() => setReturning(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setReturning(null)} disabled={loading}>Hủy</button><button className="adm-btn-primary" type="button" onClick={() => void returnWork()} disabled={loading}>Trả bài</button></>} />
  </section>;
}
