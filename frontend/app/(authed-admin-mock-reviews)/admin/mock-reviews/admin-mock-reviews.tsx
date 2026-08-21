'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, messageOf } from '@/components/admin-directory-ui';
import { normalizeExamList } from '@/lib/admin-mock-exams-model.mjs';
import {
  buildFinalBandsPayload,
  initialBandDraft,
  MOCK_REVIEW_SKILLS,
  normalizeBulkAck,
  normalizeEssayStatus,
  normalizeRetestSummary,
  normalizeReviewDetail,
  normalizeReviewRoster,
  normalizeSkillReview,
  overallPreview,
  reviewBandSkills,
} from '@/lib/admin-mock-reviews-model.mjs';

type Notice = { kind: 'success' | 'warning' | 'error'; message: string };
type Lr = { score: number | null; max: number | null; band: number | null };
type RosterRow = {
  sittingId: string; reviewId: string | null; studentName: string; sittingStatus: string;
  listening: Lr; reading: Lr;
  writing: { task1Wc: number | null; task2Wc: number | null; task1EssayId: string | null; task2EssayId: string | null; band: number | null; bandIsFinal: boolean };
  speaking: { count: number; band: number | null; bandIsFinal: boolean };
  reviewStatus: string | null; claimed: boolean; needsRetest: boolean; retestFlags: Record<string, boolean>;
};
type RetestSummary = { totalSittings: number; reviewedSittings: number; needsRetestCount: number; perSkill: Record<string, number>; students: { sittingId: string; userId: string | null; studentName: string; skills: string[] }[] };
type Detail = {
  review: { id: string; sittingId: string; status: string; claimedBy: string | null; aiDraft: Record<string, unknown>; finalBands: Record<string, number>; perSkillNotes: Record<string, unknown>; retestFlags: Record<string, boolean>; examinerComment: string };
  sitting: { id: string; studentName: string; status: string; listeningAttemptId: string | null; readingAttemptId: string | null; essayTask1Id: string | null; essayTask2Id: string | null; speakingSessionIds: string[]; writingSubmission: Record<string, unknown> };
  requiredSkills: string[]; blankableSkills: string[];
};
type EssayState = { status: string };
type SkillReview = { score?: number; max_score?: number; band_estimate?: number; review?: { q_num?: number; user_answer?: string; expected?: string; correct?: boolean }[]; skill_breakdown?: Record<string, { correct?: number; total?: number }>; trap_analytics?: Record<string, { caught?: number; missed?: number }> };
type Skip = { sittingId: string; reason: string };

const LABEL: Record<string, string> = { listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };
const STATUS: Record<string, string> = { queued: 'Chưa nhận', claimed: 'Đã nhận', edited: 'Đang hiệu chỉnh', reviewed: 'Đã duyệt', released: 'Đã trả bài' };
const ESSAY_STATUS: Record<string, string> = { pending: 'Chưa chấm', grading: 'Đang chấm', graded: 'Đã chấm (AI)', reviewed: 'Đã duyệt', delivered: 'Đã trả bài', failed: 'Lỗi chấm' };
const SOURCE: Record<string, string> = { listening: 'Tự tính từ số câu đúng', reading: 'Tự tính từ số câu đúng', writing: 'Gợi ý từ hai bài đã chấm', speaking: 'Bài chấm trực tiếp' };
const CRITERIA = [['fc', 'Fluency & Coherence'], ['lr', 'Lexical Resource'], ['gra', 'Grammar'], ['p', 'Pronunciation']] as const;

function fmtBand(value: number | null | undefined) { return value == null ? '—' : value.toFixed(1); }
function lrText(value: Lr) { return value.score == null ? '—' : `${value.score}/${value.max ?? '?'}${value.band == null ? '' : ` · B${fmtBand(value.band)}`}`; }
function writingText(row: RosterRow['writing']) {
  const counts = row.task1Wc != null || row.task2Wc != null ? `T1 ${row.task1Wc ?? '—'} · T2 ${row.task2Wc ?? '—'} từ` : '';
  const score = row.band == null ? '' : `${row.bandIsFinal ? '' : '~'}B${fmtBand(row.band)}`;
  return [counts, score].filter(Boolean).join(' · ') || '—';
}

function SkillResult({ skill, result, error }: { skill: string; result: SkillReview | null; error: string }) {
  if (error) return <div className="mrr-state is-error" role="alert">{error}</div>;
  if (!result) return <div className="mrr-state">Không có attempt {LABEL[skill]}.</div>;
  const breakdown = skill === 'reading' ? result.skill_breakdown : result.trap_analytics;
  return <div className="mrr-skill-result">
    <p>Kết quả <strong>{result.score ?? '—'}/{result.max_score ?? '—'}</strong> · Band ước tính <strong>{fmtBand(result.band_estimate)}</strong></p>
    {breakdown && <div className="mrr-chips">{Object.entries(breakdown).map(([key, raw]) => <span key={key}>{key}: {'correct' in raw ? `${raw.correct ?? 0}/${raw.total ?? 0}` : `bắt ${raw.caught ?? 0} · trượt ${raw.missed ?? 0}`}</span>)}</div>}
    {Boolean(result.review?.length) && <div className="adm-table-wrap"><table className="adm-table mrr-question-table"><thead><tr><th>Câu</th><th>Trả lời</th><th>Đáp án</th><th>KQ</th></tr></thead><tbody>{result.review!.map((row, index) => <tr key={`${row.q_num ?? index}`}><td>{row.q_num ?? index + 1}</td><td>{row.user_answer || '—'}</td><td>{row.expected || '—'}</td><td className={row.correct ? 'is-ok' : 'is-bad'}>{row.correct ? '✓' : '✗'}</td></tr>)}</tbody></table></div>}
  </div>;
}

export function AdminMockReviews({ examId, embedded }: { examId: string; embedded: boolean }) {
  const profile = useAdminProfile();
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [summary, setSummary] = useState<RetestSummary | null>(null);
  const [examTitle, setExamTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [rosterError, setRosterError] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [skips, setSkips] = useState<Skip[]>([]);
  const [tier, setTier] = useState('standard');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeSkill, setActiveSkill] = useState('listening');
  const [bandDraft, setBandDraft] = useState<Record<string, string>>({});
  const [flagDraft, setFlagDraft] = useState<Record<string, boolean>>({});
  const [comment, setComment] = useState('');
  const [channel, setChannel] = useState('in_app');
  const [essayStates, setEssayStates] = useState<Record<string, EssayState>>({});
  const [essayErrors, setEssayErrors] = useState<Record<string, string>>({});
  const [skillResults, setSkillResults] = useState<Record<string, SkillReview>>({});
  const [skillErrors, setSkillErrors] = useState<Record<string, string>>({});
  const [releaseTarget, setReleaseTarget] = useState<{ kind: 'one'; id: string; name: string } | { kind: 'bulk'; ids: string[] } | null>(null);
  const [speakingDraft, setSpeakingDraft] = useState<Record<string, string>>({ intro: '' });
  const accountRef = useRef(profile.id);
  const requestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const rowsRef = useRef<RosterRow[]>([]);
  accountRef.current = profile.id; rowsRef.current = rows;

  const loadSummary = useCallback(async () => {
    if (!examId) return null;
    const account = profile.id;
    try {
      const normalized = normalizeRetestSummary(await window.api.get<unknown>(`/admin/mock-exams/${encodeURIComponent(examId)}/retest-summary`)) as RetestSummary | null;
      if (accountRef.current !== account) return null;
      if (!normalized) throw new Error('Tổng kết test lại sai contract.');
      setSummary(normalized); setSummaryError(''); return normalized;
    } catch (caught) {
      if (accountRef.current === account) { setSummary(null); setSummaryError(`Không tải được tổng kết test lại: ${messageOf(caught)}`); }
      return null;
    }
  }, [examId, profile.id]);

  const loadRoster = useCallback(async (silent = false) => {
    if (!examId) { setLoading(false); setRosterError('Thiếu mock_exam_id; chọn một kỳ thi từ workspace Mock Test.'); return null; }
    const request = ++requestRef.current;
    const account = profile.id;
    if (!silent) setLoading(true);
    try {
      const normalized = normalizeReviewRoster(await window.api.get<unknown>(`/admin/mock-exams/${encodeURIComponent(examId)}/roster`)) as { rows: RosterRow[]; malformedCount: number } | null;
      if (request !== requestRef.current || accountRef.current !== account) return null;
      if (!normalized) throw new Error('Bảng duyệt sai contract.');
      rowsRef.current = normalized.rows; setRows(normalized.rows); setSelected(new Set()); setRosterError('');
      if (normalized.malformedCount) setNotice({ kind: 'warning', message: `${normalized.malformedCount} dòng sai contract/duplicate đã bị loại; chưa thể coi bảng này là đầy đủ.` });
      return normalized.rows;
    } catch (caught) {
      if (request === requestRef.current && accountRef.current === account) { setRows([]); rowsRef.current = []; setRosterError(`Không tải được bảng lớp: ${messageOf(caught)}`); }
      return null;
    } finally { if (request === requestRef.current && accountRef.current === account) setLoading(false); }
  }, [examId, profile.id]);

  useEffect(() => {
    let dead = false;
    const account = profile.id;
    setExamTitle(''); setDetail(null); setNotice(null); setSkips([]); setSummary(null); setSummaryError('');
    if (!examId) { setLoading(false); setRosterError('Thiếu mock_exam_id; chọn một kỳ thi từ workspace Mock Test.'); return () => { dead = true; }; }
    void loadRoster(); void loadSummary();
    (async () => {
      try {
        const normalized = normalizeExamList(await window.api.get<unknown>('/admin/mock-exams'));
        if (dead || accountRef.current !== account || !normalized) return;
        const exam = normalized.rows.find((item: { id: string }) => item.id === examId);
        setExamTitle(exam ? `${exam.code} — ${exam.title}` : `Đề ${examId}`);
      } catch { if (!dead && accountRef.current === account) setExamTitle(`Đề ${examId}`); }
    })();
    return () => { dead = true; requestRef.current += 1; detailRequestRef.current += 1; };
  }, [examId, loadRoster, loadSummary, profile.id]);

  const openDetail = async (reviewId: string, keepSkill = 'listening') => {
    const request = ++detailRequestRef.current;
    const account = profile.id;
    setDetailLoading(true); setDetailError(''); setNotice(null); setEssayStates({}); setEssayErrors({}); setSkillResults({}); setSkillErrors({});
    try {
      const normalized = normalizeReviewDetail(await window.api.get<unknown>(`/admin/mock-reviews/${encodeURIComponent(reviewId)}`)) as Detail | null;
      if (request !== detailRequestRef.current || accountRef.current !== account) return null;
      if (!normalized || normalized.review.id !== reviewId) throw new Error('Hồ sơ sai contract hoặc sai review_id.');
      setDetail(normalized); setBandDraft(initialBandDraft(normalized) as Record<string, string>); setFlagDraft(normalized.review.retestFlags); setComment(normalized.review.examinerComment); setActiveSkill(keepSkill);
      const speakingRaw = normalized.review.perSkillNotes.speaking;
      const speaking = speakingRaw && typeof speakingRaw === 'object' && !Array.isArray(speakingRaw) ? speakingRaw as Record<string, unknown> : {};
      const speakingBands = speaking.bands && typeof speaking.bands === 'object' && !Array.isArray(speaking.bands) ? speaking.bands as Record<string, unknown> : {};
      const speakingSections = Array.isArray(speaking.sections) ? speaking.sections : [];
      const nextSpeaking: Record<string, string> = { intro: typeof speaking.intro === 'string' ? speaking.intro : '' };
      CRITERIA.forEach(([key], index) => {
        const value = speakingBands[key];
        const section = speakingSections[index] && typeof speakingSections[index] === 'object' && !Array.isArray(speakingSections[index]) ? speakingSections[index] as Record<string, unknown> : {};
        nextSpeaking[key] = typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
        nextSpeaking[`body${index}`] = typeof section.body === 'string' ? section.body : '';
        nextSpeaking[`advice${index}`] = typeof section.advice === 'string' ? section.advice : '';
      });
      setSpeakingDraft(nextSpeaking);
      const essays = [['task1', normalized.sitting.essayTask1Id], ['task2', normalized.sitting.essayTask2Id]] as const;
      const attempts = [['listening', normalized.sitting.listeningAttemptId], ['reading', normalized.sitting.readingAttemptId]] as const;
      await Promise.all([
        ...essays.filter(([, id]) => id).map(async ([task, id]) => { try { const value = normalizeEssayStatus(await window.api.get<unknown>(`/admin/writing/essays/${encodeURIComponent(id!)}/status`)) as EssayState | null; if (!value) throw new Error('status essay sai contract'); if (request === detailRequestRef.current) setEssayStates((old) => ({ ...old, [task]: value })); } catch (caught) { if (request === detailRequestRef.current) setEssayErrors((old) => ({ ...old, [task]: `Không tải được trạng thái Task ${task === 'task1' ? 1 : 2}: ${messageOf(caught)}` })); } }),
        ...attempts.filter(([, id]) => id).map(async ([skill, id]) => { const path = skill === 'reading' ? `/api/reading/test/attempts/${encodeURIComponent(id!)}/review` : `/api/listening/tests/attempts/${encodeURIComponent(id!)}/review`; try { const value = normalizeSkillReview(await window.api.get<unknown>(path)) as SkillReview | null; if (!value) throw new Error(`kết quả ${skill} sai contract`); if (request === detailRequestRef.current) setSkillResults((old) => ({ ...old, [skill]: value })); } catch (caught) { if (request === detailRequestRef.current) setSkillErrors((old) => ({ ...old, [skill]: `Không tải được kết quả ${LABEL[skill]}: ${messageOf(caught)}` })); } }),
      ]);
      return normalized;
    } catch (caught) {
      if (request === detailRequestRef.current && accountRef.current === account) { setDetail(null); setDetailError(`Không mở được hồ sơ: ${messageOf(caught)}`); }
      return null;
    } finally { if (request === detailRequestRef.current && accountRef.current === account) setDetailLoading(false); }
  };

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.sittingId)), [rows, selected]);
  const actionRows = (statuses: string[]) => selectedRows.filter((row) => row.reviewStatus && statuses.includes(row.reviewStatus));
  const reconcileBulk = async (kind: 'claim' | 'bands' | 'release', ids: string[]) => {
    if (!ids.length || busy) return;
    const keys = { claim: 'claimed', bands: 'saved', release: 'released' } as const;
    setBusy(kind); setNotice(null); setSkips([]);
    try {
      const raw = await window.api.post<unknown>(`/admin/mock-exams/${encodeURIComponent(examId)}/bulk-${kind === 'bands' ? 'final-bands' : kind}`, { sitting_ids: ids });
      const ack = normalizeBulkAck(raw, keys[kind]) as { successes: string[]; skipped: Skip[] } | null;
      if (!ack) throw new Error('Phản hồi batch sai contract.');
      const canonical = await loadRoster(); await loadSummary();
      if (!canonical) { setNotice({ kind: 'error', message: 'Backend có thể đã ghi batch nhưng chưa đọc lại được trạng thái canonical. Không bấm lại; tải lại để đối chiếu.' }); return; }
      const expected = kind === 'claim' ? ['claimed', 'edited', 'reviewed', 'released'] : kind === 'bands' ? ['reviewed', 'released'] : ['released'];
      const confirmed = ack.successes.filter((id) => canonical.some((row) => row.sittingId === id && expected.includes(row.reviewStatus || '')));
      const covered = new Set([...ack.successes, ...ack.skipped.map((skip) => skip.sittingId)]);
      const reconciliationSkips = ack.successes.filter((id) => !confirmed.includes(id)).map((id) => ({ sittingId: id, reason: 'ACK thành công nhưng canonical readback chưa xác nhận.' }));
      const missingSkips = ids.filter((id) => !covered.has(id)).map((id) => ({ sittingId: id, reason: 'Backend không trả kết quả cho sitting này.' }));
      const allSkips = [...ack.skipped, ...reconciliationSkips, ...missingSkips];
      setSkips(allSkips);
      setNotice({ kind: confirmed.length === ids.length && !allSkips.length ? 'success' : 'warning', message: `Backend xác nhận ${confirmed.length}/${ids.length} bài đã ${kind === 'claim' ? 'nhận' : kind === 'bands' ? 'chốt band' : 'công bố'}.${allSkips.length ? ` ${allSkips.length} bài chưa được xác nhận; xem lý do bên dưới.` : ''}` });
    } catch (caught) {
      await loadRoster();
      setNotice({ kind: 'error', message: `${messageOf(caught)} Đã đọc lại bảng canonical; không tự gửi lại batch.` });
    } finally { setBusy(''); setReleaseTarget(null); }
  };

  const bulkGrade = async () => {
    const ids = selectedRows.filter((row) => !row.needsRetest && (row.writing.task1EssayId || row.writing.task2EssayId)).map((row) => row.sittingId);
    if (!ids.length || busy) return;
    setBusy('grade'); setNotice(null);
    try {
      const raw = await window.api.post<Record<string, unknown>>(`/admin/mock-exams/${encodeURIComponent(examId)}/writing/bulk-grade`, { sitting_ids: ids, grading_tier: tier });
      if (!Array.isArray(raw.queued) || !Array.isArray(raw.skipped) || !Array.isArray(raw.retest_skipped) || !Array.isArray(raw.short)) throw new Error('ACK hàng chấm sai contract.');
      await loadRoster();
      setNotice({ kind: 'success', message: `Đã xếp ${raw.queued.length} essay vào hàng chấm · bỏ qua ${raw.skipped.length} đã xử lý · ${raw.short.length} bài quá ngắn · ${raw.retest_skipped.length} lượt test lại.` });
    } catch (caught) { await loadRoster(); setNotice({ kind: 'error', message: `${messageOf(caught)} Không tự gửi lại để tránh chấm hai lần.` }); }
    finally { setBusy(''); }
  };

  const setRetestFlags = async (row: RosterRow, skill: string, value: boolean) => {
    if (busy) return;
    const flags: Record<string, boolean> = {};
    MOCK_REVIEW_SKILLS.forEach((key: string) => { flags[key] = key === skill ? value : row.retestFlags[key] === true; });
    setBusy(`flags:${row.sittingId}`); setNotice(null);
    try {
      await window.api.post(`/admin/mock-exams/sittings/${encodeURIComponent(row.sittingId)}/retest-flags`, { retest_flags: flags });
      const canonical = await loadRoster(); await loadSummary();
      const saved = canonical?.find((item) => item.sittingId === row.sittingId)?.retestFlags[skill] === value;
      setNotice(saved ? { kind: 'success', message: value ? `Đã đánh dấu ${LABEL[skill]} cần test lại.` : `Đã bỏ đánh dấu ${LABEL[skill]}.` } : { kind: 'error', message: 'Backend không xác nhận cờ test lại vừa chọn.' });
    } catch (caught) { await loadRoster(); await loadSummary(); setNotice({ kind: 'error', message: `Không cập nhật được: ${messageOf(caught)} Bảng đã được đọc lại từ backend.` }); }
    finally { setBusy(''); }
  };

  const reconcileDetailMutation = async (key: string, op: () => Promise<unknown>, check: (value: Detail) => boolean, success: string) => {
    if (!detail || busy) return null;
    const id = detail.review.id;
    setBusy(key); setNotice(null);
    let operationError: unknown = null;
    try { try { await op(); } catch (caught) { operationError = caught; }
      const canonical = await openDetail(id, activeSkill);
      if (!canonical) { setNotice({ kind: 'error', message: 'Yêu cầu có thể đã được ghi nhưng chưa xác nhận được hồ sơ canonical. Không thao tác lại; tải lại hồ sơ.' }); return null; }
      if (check(canonical)) { setNotice({ kind: 'success', message: operationError ? `${success} Backend đã xác nhận dù phản hồi ban đầu bị gián đoạn.` : success }); return canonical; }
      setNotice({ kind: 'error', message: operationError ? messageOf(operationError) : 'Backend không xác nhận thay đổi vừa yêu cầu.' }); return null;
    } finally { setBusy(''); }
  };

  const saveBands = async () => {
    if (!detail) return;
    const built = buildFinalBandsPayload(detail, bandDraft, flagDraft, comment) as { ok: false; error: string } | { ok: true; value: { final_bands: Record<string, number>; examiner_comment_vi: string | null; retest_flags: Record<string, boolean> } };
    if (!built.ok) { setNotice({ kind: 'error', message: built.error }); return; }
    const payload = built.value;
    await reconcileDetailMutation('save', () => window.api.post(`/admin/mock-reviews/${encodeURIComponent(detail.review.id)}/final-bands`, payload), (value) => value.review.status === 'reviewed' && Object.entries(payload.final_bands).every(([skill, band]) => value.review.finalBands[skill] === band), 'Đã lưu band cuối và đọc lại hồ sơ canonical.');
  };

  const confirmRelease = async () => {
    if (!releaseTarget) return;
    if (releaseTarget.kind === 'bulk') { await reconcileBulk('release', releaseTarget.ids); return; }
    if (!detail) return;
    const id = releaseTarget.id;
    const done = await reconcileDetailMutation('release', () => window.api.post(`/admin/mock-reviews/${encodeURIComponent(id)}/release`, { channel }), (value) => value.review.status === 'released', 'Đã công bố kết quả cho học viên.');
    if (done) { setReleaseTarget(null); await loadRoster(); await loadSummary(); }
  };

  const saveSpeaking = async () => {
    if (!detail) return;
    const bands: Record<string, number> = {};
    for (const [key, label] of CRITERIA) { const text = (speakingDraft[key] || '').trim(); const value = Number(text); if (!text || !Number.isFinite(value) || value < 0 || value > 9 || value * 2 !== Math.round(value * 2)) { setNotice({ kind: 'error', message: `Band ${label} phải từ 0–9 theo bước 0.5.` }); return; } bands[key] = value; }
    const sections = CRITERIA.map(([, label], index) => ({ title: `${index + 1}. ${label}`, body: (speakingDraft[`body${index}`] || '').trim(), advice: (speakingDraft[`advice${index}`] || '').trim() || null }));
    await reconcileDetailMutation('speaking', () => window.api.post(`/admin/mock-reviews/${encodeURIComponent(detail.review.id)}/speaking-assessment`, { bands, intro: speakingDraft.intro.trim() || null, sections }), (value) => Boolean(value.review.aiDraft.speaking) && Boolean(value.review.perSkillNotes.speaking), 'Đã lưu bài chấm Speaking.');
  };

  const startEssay = async (task: string, essayId: string) => {
    if (!detail || busy) return;
    setBusy(`essay:${task}`); setNotice(null);
    let operationError: unknown = null;
    try {
      try { await window.api.post(`/admin/writing/essays/${encodeURIComponent(essayId)}/start-grading`, { grading_tier: tier }); } catch (caught) { operationError = caught; }
      let canonical: EssayState | null = null;
      try { canonical = normalizeEssayStatus(await window.api.get<unknown>(`/admin/writing/essays/${encodeURIComponent(essayId)}/status`)) as EssayState | null; } catch { canonical = null; }
      if (!canonical) {
        setNotice({ kind: 'error', message: 'Lệnh chấm có thể đã được nhận nhưng chưa đọc lại được trạng thái essay. Không bấm lại để tránh tạo hai job.' });
      } else if (['grading', 'graded', 'reviewed', 'delivered'].includes(canonical.status)) {
        setEssayStates((old) => ({ ...old, [task]: canonical! }));
        setNotice({ kind: 'success', message: operationError ? 'Backend xác nhận essay đã rời pending dù phản hồi ban đầu bị gián đoạn.' : `Đã đưa ${task === 'task1' ? 'Task 1' : 'Task 2'} vào hàng chấm.` });
      } else setNotice({ kind: 'error', message: operationError ? messageOf(operationError) : `Backend báo essay ở trạng thái ${canonical.status}; không coi lệnh chấm là thành công và không tự gửi lại.` });
    } finally { setBusy(''); }
  };

  const closeDetail = () => { detailRequestRef.current += 1; setDetail(null); setDetailError(''); setNotice(null); void loadRoster(); void loadSummary(); };
  const preview = overallPreview(detail, bandDraft) as number | null;
  const bandSkills = reviewBandSkills(detail) as string[];
  const reviewCounts = useMemo(() => ({
    queued: rows.filter((row) => row.reviewStatus === 'queued').length,
    working: rows.filter((row) => ['claimed', 'edited'].includes(row.reviewStatus || '')).length,
    reviewed: rows.filter((row) => row.reviewStatus === 'reviewed').length,
    released: rows.filter((row) => row.reviewStatus === 'released').length,
  }), [rows]);

  return <main className={`mrr-shell${embedded ? ' is-embedded' : ''}`}>
    {!embedded && <><header className="mrr-hero"><div><p className="mrr-kicker">Mock Test · Bàn chấm</p><h1>Nhận bài, chấm nháp & trả kết quả</h1><p>Claim hồ sơ cho giám khảo, đối chiếu từng kỹ năng, chốt band và chỉ trả kết quả sau khi backend xác nhận.</p></div></header><nav className="aop-workflow" aria-label="Quy trình vận hành đề thi"><div className="aop-workflow__step"><b>01</b><span><strong>Soạn đề</strong><small>Nội dung & thời lượng</small></span></div><div className="aop-workflow__step"><b>02</b><span><strong>Giao đề</strong><small>Publish & gán lớp</small></span></div><div className="aop-workflow__step"><b>03</b><span><strong>Phòng live</strong><small>Mở phần & theo dõi</small></span></div><div className="aop-workflow__step"><b>04</b><span><strong>Thu bài</strong><small>Sweep & đối chiếu</small></span></div><div className="aop-workflow__step is-current"><b>05</b><span><strong>Chấm nháp</strong><small>Nhận hồ sơ & chốt band</small></span></div><div className="aop-workflow__step is-current"><b>06</b><span><strong>Trả kết quả</strong><small>Công bố canonical</small></span></div></nav></>}
    <section className="mrr-context"><div><span>Kỳ thi đang duyệt</span><strong>{examTitle || (examId ? 'Đang tải định danh…' : 'Chưa chọn')}</strong></div><button className="adm-btn-secondary" type="button" disabled={!examId || loading || Boolean(busy)} onClick={() => { void loadRoster(); void loadSummary(); }}>{loading ? 'Đang tải…' : '↻ Tải lại'}</button></section>
    {notice && <div className={`mrr-alert is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>}
    {detailError && <div className="mrr-state is-error" role="alert">{detailError}<button className="adm-btn-secondary" type="button" onClick={() => setDetailError('')}>Đóng</button></div>}
    {!detail && <>
      <section className="mrr-pipeline" aria-label="Tiến độ bàn chấm"><article><span>Chờ nhận</span><strong>{reviewCounts.queued}</strong><small>hồ sơ chưa có giám khảo</small></article><article><span>Đang chấm nháp</span><strong>{reviewCounts.working}</strong><small>đã claim hoặc đang sửa</small></article><article><span>Sẵn sàng trả</span><strong>{reviewCounts.reviewed}</strong><small>đã chốt band cuối</small></article><article className="is-done"><span>Đã trả kết quả</span><strong>{reviewCounts.released}</strong><small>học viên đã xem được</small></article></section>
      {summaryError ? <div className="mrr-state is-error" role="alert">{summaryError}<button className="adm-btn-secondary" type="button" onClick={() => void loadSummary()}>Thử lại tổng kết</button></div> : summary && <section className="mrr-summary"><div><span>Đã duyệt</span><strong>{summary.reviewedSittings}/{summary.totalSittings}</strong></div><div><span>Cần test lại</span><strong>{summary.needsRetestCount}</strong></div>{MOCK_REVIEW_SKILLS.map((skill: string) => <div key={skill}><span>{LABEL[skill]}</span><strong>{summary.perSkill[skill]}</strong></div>)}</section>}
      {summary?.students.length ? <details className="mrr-retest-list"><summary>Danh sách {summary.students.length} học viên cần test lại</summary>{summary.students.map((student) => <p key={student.sittingId}><strong>{student.studentName}</strong> — {student.skills.length ? student.skills.map((skill) => LABEL[skill]).join(', ') : 'đánh dấu sớm, chưa chọn kỹ năng'}</p>)}</details> : null}
      {rosterError ? <div className="mrr-state is-error" role="alert">{rosterError}<button className="adm-btn-primary" type="button" onClick={() => void loadRoster()}>Thử lại bảng lớp</button></div> : loading ? <div className="mrr-state" role="status">Đang tải bảng lớp canonical…</div> : <section className="mrr-roster-card">
        <div className="mrr-bulkbar"><div className="mrr-selection"><label><input type="checkbox" checked={Boolean(rows.some((row) => row.reviewId) && rows.filter((row) => row.reviewId).every((row) => selected.has(row.sittingId)))} onChange={(event) => setSelected(event.target.checked ? new Set(rows.filter((row) => row.reviewId).map((row) => row.sittingId)) : new Set())}/> Chọn tất cả</label><span>{selected.size ? `${selected.size} đang chọn` : `${rows.length} học viên · ${rows.filter((row) => row.reviewId).length} có hồ sơ`}</span></div><div className="mrr-grade-tools"><span>Chấm nháp Writing</span><select aria-label="Gói chấm Writing" value={tier} onChange={(event) => setTier(event.target.value)}><option value="standard">Standard</option><option value="instructor">Instructor</option></select><button className="adm-btn-secondary" disabled={!selectedRows.some((row) => !row.needsRetest && (row.writing.task1EssayId || row.writing.task2EssayId)) || Boolean(busy)} onClick={() => void bulkGrade()}>Đưa vào hàng chấm</button></div><div className="mrr-bulk-actions"><button className="adm-btn-secondary" disabled={!actionRows(['queued']).length || Boolean(busy)} onClick={() => void reconcileBulk('claim', actionRows(['queued']).map((row) => row.sittingId))}>Nhận bài ({actionRows(['queued']).length})</button><button className="adm-btn-secondary" disabled={!actionRows(['claimed', 'edited']).length || Boolean(busy)} onClick={() => void reconcileBulk('bands', actionRows(['claimed', 'edited']).map((row) => row.sittingId))}>Chốt band ({actionRows(['claimed', 'edited']).length})</button><button className="adm-btn-primary" disabled={!actionRows(['reviewed']).length || Boolean(busy)} onClick={() => setReleaseTarget({ kind: 'bulk', ids: actionRows(['reviewed']).map((row) => row.sittingId) })}>Trả kết quả ({actionRows(['reviewed']).length})</button></div></div>
        {skips.length > 0 && <div className="mrr-skips" role="alert"><strong>{skips.length} bài chưa xử lý được:</strong><ul>{skips.map((skip) => <li key={`${skip.sittingId}:${skip.reason}`}><code>{skip.sittingId.slice(0, 8)}</code> — {skip.reason}</li>)}</ul></div>}
        {!rows.length ? <div className="mrr-empty">Chưa có học viên nào trong kỳ thi này.</div> : <div className="adm-table-wrap"><table className="adm-table mrr-roster"><thead><tr><th aria-label="Chọn"/><th>Học viên</th><th>Listening</th><th>Reading</th><th>Writing</th><th>Speaking</th><th>Test lại</th><th>Trạng thái</th></tr></thead><tbody>{rows.map((row) => <tr key={row.sittingId} className={`${row.needsRetest || Object.values(row.retestFlags).some(Boolean) ? 'is-retest' : ''}${row.reviewId ? ' is-openable' : ''}`} onDoubleClick={() => row.reviewId && void openDetail(row.reviewId)}><td><input aria-label={`Chọn ${row.studentName}`} type="checkbox" checked={selected.has(row.sittingId)} disabled={!row.reviewId} onChange={(event) => setSelected((old) => { const next = new Set(old); if (event.target.checked) next.add(row.sittingId); else next.delete(row.sittingId); return next; })}/></td><td><button className="mrr-student" type="button" disabled={!row.reviewId || detailLoading} onClick={() => row.reviewId && void openDetail(row.reviewId)}>{row.studentName}</button><small>{row.sittingStatus || '—'}</small></td><td>{lrText(row.listening)}</td><td>{lrText(row.reading)}</td><td>{writingText(row.writing)}</td><td>{row.speaking.band == null ? (row.speaking.count ? `${row.speaking.count} session` : '—') : `${row.speaking.bandIsFinal ? '' : '~'}B${fmtBand(row.speaking.band)}${row.speaking.count ? ` · ${row.speaking.count} session` : ''}`}</td><td><div className="mrr-flags">{MOCK_REVIEW_SKILLS.map((skill: string) => <label key={skill} title={LABEL[skill]}><input type="checkbox" checked={row.retestFlags[skill] === true} disabled={!row.reviewId || Boolean(busy)} onChange={(event) => void setRetestFlags(row, skill, event.target.checked)}/>{skill[0].toUpperCase()}</label>)}</div></td><td><span className={`mrr-status is-${row.reviewStatus || 'wip'}`}>{STATUS[row.reviewStatus || ''] || (row.reviewId ? row.reviewStatus : 'Đang làm')}</span></td></tr>)}</tbody></table></div>}
      </section>}
    </>}
    {detailLoading && !detail && <div className="mrr-state" role="status">Đang tải hồ sơ canonical và các kỹ năng…</div>}
    {detail && <section className="mrr-detail">
      <div className="mrr-detail-head"><button className="adm-btn-secondary" type="button" disabled={Boolean(busy)} onClick={closeDetail}>← Bảng lớp</button><div><span className={`mrr-status is-${detail.review.status}`}>{STATUS[detail.review.status] || detail.review.status}</span><h2>{detail.sitting.studentName}</h2><p>Hồ sơ <code>{detail.review.id.slice(0, 8)}</code> · lượt thi <code>{detail.sitting.id.slice(0, 8)}</code></p></div><div className="mrr-detail-actions">{detail.review.status === 'queued' && <button className="adm-btn-primary" disabled={Boolean(busy)} onClick={() => void reconcileDetailMutation('claim', () => window.api.post(`/admin/mock-reviews/${encodeURIComponent(detail.review.id)}/claim`, {}), (value) => value.review.status !== 'queued' && value.review.claimedBy === profile.id, 'Đã nhận hồ sơ.')}>Nhận bài để chấm</button>}{['claimed', 'edited'].includes(detail.review.status) && <button className="adm-btn-secondary" disabled={Boolean(busy)} onClick={() => void reconcileDetailMutation('unclaim', () => window.api.post(`/admin/mock-reviews/${encodeURIComponent(detail.review.id)}/release-claim`, {}), (value) => value.review.status === 'queued' && !value.review.claimedBy, 'Đã trả hồ sơ về hàng chờ.')}>Bỏ nhận</button>}</div></div>
      <nav className="mrr-tabs" aria-label="Kỹ năng">{MOCK_REVIEW_SKILLS.map((skill: string) => <button type="button" key={skill} className={activeSkill === skill ? 'is-active' : ''} aria-pressed={activeSkill === skill} onClick={() => setActiveSkill(skill)}>{LABEL[skill]}</button>)}</nav>
      <div className="mrr-skill-panel">{activeSkill === 'listening' && <SkillResult skill="listening" result={detail.sitting.listeningAttemptId ? skillResults.listening || null : null} error={skillErrors.listening || ''}/>} {activeSkill === 'reading' && <SkillResult skill="reading" result={detail.sitting.readingAttemptId ? skillResults.reading || null : null} error={skillErrors.reading || ''}/>} {activeSkill === 'writing' && <WritingPanel detail={detail} states={essayStates} errors={essayErrors} tier={tier} setTier={setTier} busy={Boolean(busy)} onStart={startEssay}/>} {activeSkill === 'speaking' && <SpeakingPanel detail={detail} draft={speakingDraft} setDraft={setSpeakingDraft} busy={Boolean(busy)} onSave={saveSpeaking}/>}</div>
      <section className="mrr-band-card"><div><p className="mrr-kicker">Quyết định của giám khảo</p><h3>Chốt band & trả kết quả</h3><p>Band gợi ý chỉ là bản nháp có provenance; Overall chính thức luôn do backend tính lại.</p></div><div className="mrr-band-grid">{bandSkills.map((skill) => <label key={skill}><span>{LABEL[skill]}</span><input type="number" min="0" max="9" step="0.5" value={bandDraft[skill] || ''} disabled={detail.review.status === 'released'} onChange={(event) => setBandDraft({ ...bandDraft, [skill]: event.target.value })}/><small>{detail.blankableSkills.includes(skill) ? 'Không có band quy đổi; có thể để trống.' : SOURCE[skill]}</small>{detail.requiredSkills.includes(skill) && <em><input type="checkbox" checked={flagDraft[skill] === true} disabled={detail.review.status === 'released'} onChange={(event) => setFlagDraft({ ...flagDraft, [skill]: event.target.checked })}/> Cần test lại</em>}</label>)}</div><p className="mrr-overall">Overall xem trước <strong>{preview == null ? '—' : preview.toFixed(1)}</strong></p><label className="mrr-comment"><span>Nhận xét tổng cho học viên</span><textarea rows={4} value={comment} disabled={detail.review.status === 'released'} onChange={(event) => setComment(event.target.value)}/></label><div className="mrr-publish-row"><button className="adm-btn-secondary" type="button" disabled={Boolean(busy) || detail.review.status === 'released'} onClick={() => void saveBands()}>{busy === 'save' ? 'Đang đối chiếu…' : 'Lưu & chốt band'}</button><select aria-label="Kênh công bố" value={channel} disabled={Boolean(busy) || detail.review.status === 'released'} onChange={(event) => setChannel(event.target.value)}><option value="in_app">In-app</option><option value="email">Email</option><option value="manual">Thủ công</option></select><button className="adm-btn-primary" type="button" disabled={Boolean(busy) || detail.review.status !== 'reviewed'} onClick={() => setReleaseTarget({ kind: 'one', id: detail.review.id, name: detail.sitting.studentName })}>Trả kết quả</button>{['reviewed', 'released'].includes(detail.review.status) && <a className="adm-btn-secondary" target="_blank" rel="noreferrer" href={`/admin/mock-reviews/report?review_id=${encodeURIComponent(detail.review.id)}&mock_exam_id=${encodeURIComponent(examId)}`}>Xem phiếu điểm ↗</a>}</div><p className="mrr-caveat">Trả kết quả chỉ mở sau khi hồ sơ ở trạng thái “Đã duyệt”. Backend tiếp tục kiểm tra Writing đã duyệt và quyền claim trước khi mở khoá kết quả.</p></section>
    </section>}
    <Dialog open={Boolean(releaseTarget)} title={releaseTarget?.kind === 'bulk' ? `Công bố ${releaseTarget.ids.length} kết quả?` : `Công bố kết quả của ${releaseTarget?.name || 'học viên'}?`} description="Học viên sẽ thấy band và phần chữa bài ngay. Muốn sửa sau đó cần quy trình thu hồi riêng." busy={busy === 'release'} onClose={() => setReleaseTarget(null)} actions={<><button className="adm-btn-secondary" type="button" disabled={busy === 'release'} onClick={() => setReleaseTarget(null)}>Rà lại</button><button className="adm-btn-primary" type="button" disabled={busy === 'release'} onClick={() => void confirmRelease()}>{busy === 'release' ? 'Đang đối chiếu…' : 'Xác nhận công bố'}</button></>}><p className="mrr-dialog-copy">Mỗi bài bị backend từ chối sẽ được liệt kê theo sitting; màn hình chỉ báo thành công sau khi đọc lại trạng thái canonical.</p></Dialog>
  </main>;
}

function WritingPanel({ detail, states, errors, tier, setTier, busy, onStart }: { detail: Detail; states: Record<string, EssayState>; errors: Record<string, string>; tier: string; setTier: (value: string) => void; busy: boolean; onStart: (task: string, id: string) => Promise<void> }) {
  const submission = detail.sitting.writingSubmission;
  return <div className="mrr-writing">{(['task1', 'task2'] as const).map((task, index) => { const id = task === 'task1' ? detail.sitting.essayTask1Id : detail.sitting.essayTask2Id; const raw = submission[task] as { text?: string; word_count?: number } | undefined; return <article key={task}><div><h3>Task {index + 1}</h3>{id && <span className="mrr-status">{errors[task] ? 'Không rõ trạng thái' : ESSAY_STATUS[states[task]?.status] || states[task]?.status || 'Đang tải…'}</span>}</div>{errors[task] && <div className="mrr-state is-error" role="alert">{errors[task]}</div>}{!id ? <><p>{raw?.word_count ?? 0} từ · dữ liệu trước bước promote</p><pre>{raw?.text || '— trống —'}</pre></> : states[task]?.status === 'pending' ? <div className="mrr-essay-actions"><select value={tier} onChange={(event) => setTier(event.target.value)}><option value="standard">Standard</option><option value="instructor">Instructor</option></select><button className="adm-btn-primary" type="button" disabled={busy || Boolean(errors[task])} onClick={() => void onStart(task, id)}>Bắt đầu chấm</button></div> : <a className="adm-btn-secondary" target="_blank" rel="noreferrer" href={`/admin/writing/grade?essay_id=${encodeURIComponent(id)}`}>Mở bàn chấm Task {index + 1} ↗</a>}</article>; })}</div>;
}

function SpeakingPanel({ detail, draft, setDraft, busy, onSave }: { detail: Detail; draft: Record<string, string>; setDraft: (value: Record<string, string>) => void; busy: boolean; onSave: () => Promise<void> }) {
  return <div className="mrr-speaking"><label><span>Nhận xét chung</span><textarea rows={3} value={draft.intro || ''} onChange={(event) => setDraft({ ...draft, intro: event.target.value })}/></label><div className="mrr-speaking-grid">{CRITERIA.map(([key, label], index) => <label key={key}><span>{label}</span><input type="number" min="0" max="9" step="0.5" value={draft[key] || ''} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}/><textarea rows={2} placeholder="Nhận xét" value={draft[`body${index}`] || ''} onChange={(event) => setDraft({ ...draft, [`body${index}`]: event.target.value })}/><textarea rows={2} placeholder="Cách luyện" value={draft[`advice${index}`] || ''} onChange={(event) => setDraft({ ...draft, [`advice${index}`]: event.target.value })}/></label>)}</div><button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void onSave()}>Lưu bài chấm Speaking</button>{detail.sitting.speakingSessionIds.length > 0 && <div className="mrr-session-links"><strong>{detail.sitting.speakingSessionIds.length} session đã gắn:</strong>{detail.sitting.speakingSessionIds.map((id, index) => <a key={id} target="_blank" rel="noreferrer" href={`/full-test-result?session_id=${encodeURIComponent(id)}`}>Session {index + 1} ↗</a>)}</div>}</div>;
}
