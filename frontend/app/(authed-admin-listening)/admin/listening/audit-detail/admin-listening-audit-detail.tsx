'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  buildListeningAuditQuestionPatch,
  buildListeningAuditReceipt,
  formatListeningAuditOptions,
  listeningAuditAudioForSection,
  listeningAuditPlayback,
  listeningAuditReceiptKey,
  listeningAuditReceiptReconciled,
  normalizeListeningAuditAudio,
  normalizeListeningAuditDetail,
  normalizeListeningAuditReceipt,
  questionMatchesListeningAuditPatch,
  transcriptMatchesListeningAuditPatch,
} from '@/lib/admin-listening-audit-detail-model.mjs';

type Issue = { index: number | null; qNum: number | null; severity: 'error' | 'warning'; source: 'structural' | 'llm'; dimension: string; code: string; message: string; resolved: boolean };
type RepairField = 'alternatives' | 'traps' | 'options';
type Question = { qNum: number | null; rawQNum: string; clientKey: string; editable: boolean; identityWarning: string | null; exerciseId: string; exerciseUpdatedAt: string; templateKind: string; prompt: string; answer: string; alternatives: string[]; trapMechanisms: string[]; options: Array<{ letter: string; text: string }>; solution: string; audioWindow: { start: number | null; end: number | null; section: string | null } | null; repairWarnings: string[]; requiredRepairs: RepairField[] };
type Section = { sectionNum: number; contentId: string; contentUpdatedAt: string; audioOffset: number | null; transcript: string; questions: Question[] };
type AuditHealth = { errorCount: number; warningCount: number; status: string; requestId: string | null };
type Snapshot = { id: string; testId: string; title: string; status: string; type: string; questionCount: number; sectionCount: number; sections: Section[]; live: { health: AuditHealth; issues: Issue[] }; saved: null | { status: 'pending' | 'passed' | 'has_issues' | 'fixed'; notes: string; auditor: string | null; auditedAt: string | null; updatedAt: string; health: AuditHealth | null; issues: Issue[] } };
type AudioSet = { assembled: string | null; full: string | null; sectionUrls: Map<number, string | null> };
type Receipt = { version: 1; accountId: string; testId: string; requestId: string; baselineAuditedAt: string | null; startedAt: string; acknowledgedAuditedAt: string | null };
type AudioElement = HTMLElement & { seekTo?: (seconds: number) => void; play?: () => Promise<void> | void };
type Draft = { prompt: string; answer: string; alternatives: string; traps: string; options: string; solution: string; windowStart: string; windowEnd: string; requiredRepairs: RepairField[]; hadAudioWindow: boolean };

const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusOf = (caught: unknown) => typeof caught === 'object' && caught && 'status' in caught ? Number((caught as { status?: number }).status) : 0;
const statusLabel = { pending: 'Chưa audit', passed: 'Đạt', has_issues: 'Có lỗi', fixed: 'Đã sửa' };
const auditPath = (id: string) => `/admin/listening/tests/${encodeURIComponent(id)}/audit`;
const questionPath = (question: Question) => `/admin/listening/exercises/${encodeURIComponent(question.exerciseId)}/questions/${question.qNum}`;

export function AdminListeningAuditDetail({ testId }: { testId: string }) {
  const profile = useAdminProfile();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [audio, setAudio] = useState<AudioSet | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [confirmDiscardReceipt, setConfirmDiscardReceipt] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [triageStatus, setTriageStatus] = useState<keyof typeof statusLabel>('pending');
  const [triageNotes, setTriageNotes] = useState('');
  const [triageBaseVersion, setTriageBaseVersion] = useState<string | null>(null);
  const [resolvedIndexes, setResolvedIndexes] = useState<Set<number>>(new Set());
  const [editorEpoch, setEditorEpoch] = useState(0);
  const sequence = useRef(0); const activeAccount = useRef(profile.id); const playerRef = useRef<AudioElement | null>(null);
  activeAccount.current = profile.id;
  const receiptKey = listeningAuditReceiptKey(profile.id, testId);

  const readCanonical = useCallback(async ({ announce = false, syncTriage = false }: { announce?: boolean; syncTriage?: boolean } = {}) => {
    const owner = profile.id; const request = ++sequence.current;
    const raw = await window.api.get<unknown>(auditPath(testId));
    const next = normalizeListeningAuditDetail(raw, testId) as Snapshot | null;
    if (!next) throw new Error('Audit GET sai identity, version token, counts hoặc issue contract.');
    if (request !== sequence.current || activeAccount.current !== owner) return null;
    setSnapshot(next); setActiveSection((current) => next.sections.some((section) => section.sectionNum === current) ? current : next.sections[0]?.sectionNum ?? null);
    if (syncTriage) { setTriageStatus(next.saved?.status || 'pending'); setTriageNotes(next.saved?.notes || ''); setTriageBaseVersion(next.saved?.updatedAt || null); setResolvedIndexes(new Set()); }
    if (announce) setNotice('Đã đọc lại snapshot canonical mới nhất.');
    return next;
  }, [profile.id, testId]);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setAudioError(null); setNotice(null);
    try {
      const [next, audioResult] = await Promise.all([
        readCanonical({ syncTriage: true }),
        window.api.get<unknown>(`/admin/listening/tests/${encodeURIComponent(testId)}/audio/signed-urls`)
          .then((raw) => ({ raw, caught: null as unknown }))
          .catch((caught: unknown) => ({ raw: null, caught })),
      ]);
      if (!next) return;
      if (audioResult.caught) { setAudio(null); setAudioError(messageOf(audioResult.caught)); }
      else {
        const normalized = normalizeListeningAuditAudio(audioResult.raw) as AudioSet | null;
        setAudio(normalized); setAudioError(normalized ? null : 'Audio signed-URL response sai contract.');
      }
    } catch (caught) { setError(messageOf(caught)); }
    finally { setLoading(false); }
  }, [readCanonical, testId]);

  useEffect(() => {
    sequence.current += 1; activeAccount.current = profile.id; setSnapshot(null); setAudio(null); setAudioError(null); setReceipt(null); setEditorEpoch(0);
    const stored = normalizeListeningAuditReceipt(localStorage.getItem(receiptKey), { accountId: profile.id, testId }) as Receipt | null;
    setReceipt(stored); void load();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== receiptKey) return;
      setReceipt(normalizeListeningAuditReceipt(event.newValue, { accountId: profile.id, testId }) as Receipt | null);
    };
    window.addEventListener('storage', onStorage);
    return () => { sequence.current += 1; window.removeEventListener('storage', onStorage); };
  }, [profile.id, testId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!receipt || !snapshot || !listeningAuditReceiptReconciled(receipt, snapshot)) return;
    localStorage.removeItem(receiptKey); setReceipt(null);
    setNotice('Đã đối chiếu full audit bằng GET; receipt được khép an toàn.');
  }, [receipt, receiptKey, snapshot]);

  const reconcileReceipt = async () => {
    setBusy('reconcile'); setError(null);
    try {
      const next = await readCanonical({ syncTriage: true });
      if (!next || !receipt || !listeningAuditReceiptReconciled(receipt, next)) throw new Error('Backend chưa công bố một audited_at mới; receipt vẫn được giữ và POST không bị gửi lại.');
    } catch (caught) { setError(messageOf(caught)); }
    finally { setBusy(null); }
  };

  const discardReceipt = () => {
    localStorage.removeItem(receiptKey); setReceipt(null); setConfirmDiscardReceipt(false);
    setNotice('Đã bỏ receipt theo xác nhận. Một lượt paid audit mới có thể phát sinh thêm chi phí.');
  };

  const runFullAudit = async () => {
    if (!snapshot || receipt) return;
    setConfirmRun(false); setBusy('run'); setError(null); setNotice(null);
    const requestId = crypto.randomUUID();
    const pending = buildListeningAuditReceipt({ accountId: profile.id, testId, requestId, baselineAuditedAt: snapshot.saved?.auditedAt }) as Receipt;
    localStorage.setItem(receiptKey, JSON.stringify(pending)); setReceipt(pending);
    try {
      const raw = await window.api.post<unknown>(`${auditPath(testId)}/run`, { request_id: requestId });
      const ack = raw && typeof raw === 'object' ? raw as { uuid?: unknown; audited_at?: unknown; request_id?: unknown } : null;
      if (!ack || ack.uuid !== testId || ack.request_id !== requestId || typeof ack.audited_at !== 'string' || !ack.audited_at.trim()) throw new Error('ACK full audit sai identity/request_id; giữ receipt để chỉ GET đối chiếu.');
      const acknowledged = { ...pending, acknowledgedAuditedAt: ack.audited_at };
      localStorage.setItem(receiptKey, JSON.stringify(acknowledged)); setReceipt(acknowledged);
      const next = await readCanonical({ syncTriage: true });
      if (!next || !listeningAuditReceiptReconciled(acknowledged, next)) throw new Error('ACK đã nhận nhưng canonical GET chưa khớp audited_at; receipt vẫn được giữ.');
    } catch (caught) {
      const status = statusOf(caught);
      if (status >= 400 && status < 500) { localStorage.removeItem(receiptKey); setReceipt(null); }
      setError(`${messageOf(caught)}${status >= 500 || !status ? ' Không tự gửi lại POST; hãy đối chiếu receipt bằng GET.' : ''}`);
    } finally { setBusy(null); }
  };

  const saveTranscript = async (section: Section, transcript: string, baseVersion: string): Promise<string | null> => {
    setBusy(`transcript-${section.sectionNum}`); setError(null); setNotice(null);
    try {
      await window.api.patch(`/admin/listening/content/${encodeURIComponent(section.contentId)}`, { transcript, expected_updated_at: baseVersion });
      const next = await readCanonical();
      const canonical = next?.sections.find((item) => item.contentId === section.contentId);
      if (!transcriptMatchesListeningAuditPatch(canonical, transcript, baseVersion)) throw new Error('PATCH đã ACK nhưng canonical transcript/version chưa khớp; chưa công bố thành công.');
      setNotice(`Đã lưu và đọc lại transcript Section ${section.sectionNum}.`);
      return canonical?.contentUpdatedAt || null;
    } catch (caught) { setError(statusOf(caught) === 409 ? 'Transcript đã đổi ở tab khác. Hãy tải lại snapshot trước khi sửa tiếp.' : messageOf(caught)); }
    finally { setBusy(null); }
    return null;
  };

  const saveQuestion = async (question: Question, draft: Draft, baseVersion: string): Promise<string | null> => {
    if (!question.editable || question.qNum == null) { setError(question.identityWarning || 'Identity câu hỏi không hợp lệ; không thể PATCH an toàn.'); return null; }
    const built = buildListeningAuditQuestionPatch(draft, baseVersion) as { ok: boolean; value?: Record<string, unknown>; error?: string };
    if (!built.ok || !built.value) { setError(built.error || 'Dữ liệu câu hỏi chưa hợp lệ.'); return null; }
    setBusy(`question-${question.clientKey}`); setError(null); setNotice(null);
    try {
      await window.api.patch(questionPath(question), built.value);
      const next = await readCanonical();
      const canonical = next?.sections.flatMap((section) => section.questions).find((item) => item.qNum === question.qNum && item.exerciseId === question.exerciseId);
      if (!questionMatchesListeningAuditPatch(canonical, built.value, baseVersion)) throw new Error('PATCH đã ACK nhưng canonical question/version chưa khớp; chưa công bố thành công.');
      setNotice(`Đã lưu và đọc lại Câu ${question.qNum}.`);
      return canonical?.exerciseUpdatedAt || null;
    } catch (caught) { setError(statusOf(caught) === 409 ? `Câu ${question.qNum} đã đổi ở tab khác. Hãy tải lại snapshot.` : messageOf(caught)); }
    finally { setBusy(null); }
    return null;
  };

  const saveTriage = async () => {
    if (!snapshot?.saved) { setError('Chưa có full audit đã lưu; chạy full audit trước khi triage.'); return; }
    if (!triageBaseVersion) { setError('Saved audit thiếu version token; tải lại trước khi triage.'); return; }
    const baseUpdatedAt = triageBaseVersion;
    const unresolvedErrors = snapshot.saved.issues.filter((issue) => issue.severity === 'error' && !issue.resolved && (issue.index == null || !resolvedIndexes.has(issue.index)));
    if (['passed', 'fixed'].includes(triageStatus) && unresolvedErrors.length) { setError(`Còn ${unresolvedErrors.length} error chưa chọn xử lý; không thể đánh dấu ${statusLabel[triageStatus]}.`); return; }
    setBusy('triage'); setError(null); setNotice(null);
    try {
      await window.api.patch(auditPath(testId), { status: triageStatus, notes: triageNotes, resolved_indexes: [...resolvedIndexes].sort((a, b) => a - b), expected_updated_at: baseUpdatedAt });
      const next = await readCanonical({ syncTriage: true });
      const saved = next?.saved;
      const resolutionMatches = [...resolvedIndexes].every((index) => saved?.issues[index]?.resolved === true);
      if (!saved || saved.updatedAt === baseUpdatedAt || saved.status !== triageStatus || saved.notes !== triageNotes || !resolutionMatches) throw new Error('Triage PATCH đã ACK nhưng canonical GET/version chưa khớp.');
      setNotice('Đã lưu và đọc lại trạng thái triage canonical.');
    } catch (caught) { setError(statusOf(caught) === 409 ? 'Saved audit đã đổi ở tab khác. Hãy tải lại trước khi triage.' : messageOf(caught)); }
    finally { setBusy(null); }
  };

  const playWindow = (sectionNum: number, question: Question) => {
    const currentSection = snapshot?.sections.find((item) => item.sectionNum === sectionNum);
    const playback = listeningAuditPlayback(audio, currentSection, question.audioWindow);
    const player = playerRef.current;
    if (!playback || !player) { setError(`Section ${sectionNum} chưa có audio URL/window/timebase có thể kiểm chứng.`); return; }
    player.setAttribute('src', playback.url); player.setAttribute('segment-start', String(playback.start)); player.setAttribute('segment-end', String(playback.end));
    player.seekTo?.(playback.start); try { void player.play?.(); } catch { /* component reports playback */ }
    setNotice(`Đang nghe ${playback.source} · Section ${sectionNum} · Câu ${question.rawQNum} · ${playback.start}–${playback.end}s.`);
  };

  const reloadEditor = async () => {
    setError(null);
    try {
      const next = await readCanonical({ announce: true, syncTriage: true });
      if (next) setEditorEpoch((value) => value + 1);
    } catch (caught) { setError(messageOf(caught)); }
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!snapshot) return;
    const count = snapshot.sections.length;
    let target = index;
    if (event.key === 'ArrowRight') target = (index + 1) % count;
    else if (event.key === 'ArrowLeft') target = (index - 1 + count) % count;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = count - 1;
    else return;
    event.preventDefault(); const next = snapshot.sections[target]; setActiveSection(next.sectionNum);
    requestAnimationFrame(() => document.getElementById(`alqad-tab-${next.sectionNum}`)?.focus());
  };

  const section = snapshot?.sections.find((item) => item.sectionNum === activeSection) || null;
  const triageStale = Boolean(snapshot?.saved && triageBaseVersion && snapshot.saved.updatedAt !== triageBaseVersion);
  const issuesByQuestion = useMemo(() => {
    const map = new Map<number, { live: Issue[]; saved: Issue[] }>();
    for (const issue of snapshot?.live.issues || []) if (issue.qNum != null) (map.get(issue.qNum) || (map.set(issue.qNum, { live: [], saved: [] }), map.get(issue.qNum)!)).live.push(issue);
    for (const issue of snapshot?.saved?.issues || []) if (issue.qNum != null) (map.get(issue.qNum) || (map.set(issue.qNum, { live: [], saved: [] }), map.get(issue.qNum)!)).saved.push(issue);
    return map;
  }, [snapshot]);

  if (loading && !snapshot) return <main className="alqad-shell"><div className="alqad-state" role="status">Đang đọc audit và audio canonical…</div></main>;
  if (!snapshot) return <main className="alqad-shell"><div className="alc-banner is-error" role="alert"><strong>Không thể mở audit workspace</strong><span>{error || 'Không có snapshot hợp lệ.'}</span><button className="adm-btn-secondary" type="button" onClick={() => void load()}>Thử lại</button></div></main>;

  return <main className="alqad-shell" aria-busy={Boolean(busy)}>
    <nav className="alqad-breadcrumb" aria-label="Breadcrumb"><a href="/admin/listening/audit">Quality audit</a><span aria-hidden="true">/</span><strong>{snapshot.testId}</strong></nav>
    <header className="alqad-hero"><div><p className="alc-eyebrow">Listening · Canonical repair workspace</p><h1>{snapshot.title}</h1><p><code>{snapshot.testId}</code> · {snapshot.type} · {snapshot.questionCount} câu · {snapshot.sectionCount} section</p></div><div><span className={`adm-status-pill ${snapshot.live.health.errorCount ? 'is-failed' : snapshot.live.health.warningCount ? 'is-warning' : 'is-live'}`}>{snapshot.live.health.errorCount} error · {snapshot.live.health.warningCount} warning live</span><a className="adm-btn-secondary" href={`/pages/admin/listening/audit-detail.html?id=${encodeURIComponent(testId)}`}>HTML rollback ↗</a></div></header>

    {error && <div className="alc-banner is-error" role="alert"><strong>Chưa thể xác nhận thao tác</strong><span>{error}</span><button type="button" onClick={() => void reloadEditor()}>Tải mới & bỏ nháp</button></div>}
    {audioError && <div className="alc-banner is-warning" role="alert"><strong>Audio lookup failed</strong><span>{audioError} Không kết luận rằng test thiếu audio.</span><button type="button" disabled={Boolean(busy)} onClick={() => void load()}>Đọc lại audit + audio</button></div>}
    {notice && <div className="alc-banner is-success" role="status"><strong>Canonical truth</strong><span>{notice}</span></div>}
    {receipt && <div className="alc-banner is-warning" role="alert"><strong>Full audit đang cần đối chiếu</strong><span>Đã tạo receipt lúc {new Date(receipt.startedAt).toLocaleString('vi-VN')}. Không tự gửi lại POST.</span><button type="button" disabled={Boolean(busy)} onClick={() => void reconcileReceipt()}>{busy === 'reconcile' ? 'Đang GET…' : 'Đối chiếu bằng GET'}</button><button type="button" disabled={Boolean(busy)} onClick={() => setConfirmDiscardReceipt(true)}>Bỏ receipt & cho phép chạy lại</button></div>}

    <section className="alqad-evidence" aria-labelledby="alqad-evidence-title"><div><p className="alc-eyebrow">Evidence boundary</p><h2 id="alqad-evidence-title">Live và saved không cùng thời điểm</h2><p>Live là structural/audio GET vừa đọc. Saved là full audit gồm LLM tại <strong>{snapshot.saved?.auditedAt ? new Date(snapshot.saved.auditedAt).toLocaleString('vi-VN') : 'chưa chạy'}</strong>.</p></div><div><strong>{snapshot.live.health.errorCount}</strong><span>Live error</span></div><div><strong>{snapshot.live.health.warningCount}</strong><span>Live warning</span></div><div><strong>{snapshot.saved?.issues.filter((issue) => !issue.resolved).length || 0}</strong><span>Saved chưa resolve</span></div></section>

    <section className="alqad-ops"><div><p className="alc-eyebrow">Full audit · paid mutation</p><h2>Chạy structural + LLM</h2><p>Receipt được ghi trước POST. Nếu timeout/5xx, trang chỉ GET để đối chiếu và không tính phí lần hai.</p></div><button className="adm-btn-primary" type="button" disabled={Boolean(busy) || Boolean(receipt)} onClick={() => setConfirmRun(true)}>{busy === 'run' ? 'Đang chạy…' : 'Chạy full audit'}</button></section>

    <section className="alqad-triage" aria-labelledby="alqad-triage-title"><div className="alqad-section-head"><div><p className="alc-eyebrow">Human triage</p><h2 id="alqad-triage-title">Kết luận trên saved full audit</h2></div><button className="adm-btn-primary" type="button" disabled={Boolean(busy) || !snapshot.saved || triageStale} onClick={() => void saveTriage()}>{busy === 'triage' ? 'Đang đối chiếu…' : 'Lưu & đọc lại'}</button></div>{triageStale && <div className="alc-banner is-warning" role="alert"><strong>Saved audit đã đổi</strong><span>Giữ nguyên input hiện tại nhưng khóa Save. Chọn “Tải lại & bỏ nháp” để lấy issue indexes và ghi chú mới.</span></div>}<div className="alqad-triage-fields"><label><span>Trạng thái</span><select value={triageStatus} onChange={(event) => setTriageStatus(event.target.value as keyof typeof statusLabel)}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Ghi chú người duyệt</span><input value={triageNotes} onChange={(event) => setTriageNotes(event.target.value)} placeholder="Bằng chứng đã kiểm tra…" /></label></div>{snapshot.saved ? <IssueList issues={snapshot.saved.issues} selectable selected={resolvedIndexes} onToggle={(index) => setResolvedIndexes((current) => { const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next; })} /> : <p className="alqad-muted">Chạy full audit trước để tạo snapshot có thể triage.</p>}</section>

    <section className="alqad-editor" aria-labelledby="alqad-editor-title"><div className="alqad-section-head"><div><p className="alc-eyebrow">In-place editor</p><h2 id="alqad-editor-title">Sửa theo section, xác nhận bằng readback</h2></div><button className="adm-btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => void reloadEditor()}>Tải lại & bỏ nháp</button></div><div className="alqad-tabs" role="tablist" aria-label="Listening sections">{snapshot.sections.map((item, index) => <button key={item.sectionNum} id={`alqad-tab-${item.sectionNum}`} type="button" role="tab" aria-controls={`alqad-panel-${item.sectionNum}`} aria-selected={item.sectionNum === activeSection} tabIndex={item.sectionNum === activeSection ? 0 : -1} onKeyDown={(event) => onTabKey(event, index)} onClick={() => setActiveSection(item.sectionNum)}>Section {item.sectionNum}<span>{item.questions.length} câu</span></button>)}</div>{snapshot.sections.map((item) => <SectionEditor key={`${item.contentId}:${editorEpoch}`} section={item} active={item.sectionNum === activeSection} audio={audio} busy={busy} issues={issuesByQuestion} onSaveTranscript={saveTranscript} onSaveQuestion={saveQuestion} onPlay={playWindow} />)}</section>

    <aside className="alqad-player" aria-label="Audio kiểm chứng"><div><strong>Audio kiểm chứng</strong><span>{activeSection && listeningAuditAudioForSection(audio, activeSection) ? `Track đúng Section ${activeSection}` : 'Chưa có signed URL cho section này'}</span></div><audio-player ref={(node) => { playerRef.current = node as AudioElement | null; }} compact="" /></aside>

    <Dialog open={confirmRun} title={`Chạy full audit cho ${snapshot.testId}?`} description="Thao tác gọi LLM và ghi đè snapshot full audit trước. Receipt sẽ được tạo trước khi gửi; response mơ hồ không bao giờ bị tự động replay." busy={busy === 'run'} onClose={() => setConfirmRun(false)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setConfirmRun(false)}>Hủy</button><button className="adm-btn-primary" type="button" onClick={() => void runFullAudit()}>Tạo receipt & chạy</button></>} />
    <Dialog open={confirmDiscardReceipt} title="Bỏ receipt audit đang chờ?" description="Chỉ làm việc này sau khi đã kiểm tra backend không lưu lượt audit. Bỏ receipt sẽ mở khóa nút chạy và lượt tiếp theo có thể gọi LLM, phát sinh chi phí lần nữa." busy={false} onClose={() => setConfirmDiscardReceipt(false)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setConfirmDiscardReceipt(false)}>Giữ receipt</button><button className="adm-btn-primary" type="button" onClick={discardReceipt}>Xác nhận bỏ receipt</button></>} />
  </main>;
}

function IssueList({ issues, selectable = false, selected = new Set(), onToggle }: { issues: Issue[]; selectable?: boolean; selected?: Set<number>; onToggle?: (index: number) => void }) {
  const visible = issues.filter((issue) => !issue.resolved);
  if (!visible.length) return <p className="alqad-muted">Không có finding chưa xử lý.</p>;
  return <div className="alqad-issues">{visible.map((issue) => {
    const content = <>{selectable && issue.index != null && <input type="checkbox" checked={selected.has(issue.index)} onChange={() => onToggle?.(issue.index!)} />}<span className="alqad-source">{issue.source === 'llm' ? 'LLM' : 'STRUCTURAL'}</span><strong>{issue.qNum == null ? 'Toàn test' : `Câu ${issue.qNum}`} · {issue.code}</strong><span>{issue.message}</span></>;
    return selectable ? <label key={`${issue.index}-${issue.qNum}-${issue.code}`} className={`alqad-issue is-${issue.severity}`}>{content}</label>
      : <div key={`${issue.index}-${issue.qNum}-${issue.code}`} className={`alqad-issue is-${issue.severity}`}>{content}</div>;
  })}</div>;
}

const draftFromQuestion = (question: Question): Draft => ({ prompt: question.prompt, answer: question.answer, alternatives: question.alternatives.join('\n'), traps: question.trapMechanisms.join('\n'), options: formatListeningAuditOptions(question.options), solution: question.solution, windowStart: question.audioWindow?.start == null ? '' : String(question.audioWindow.start), windowEnd: question.audioWindow?.end == null ? '' : String(question.audioWindow.end), requiredRepairs: question.requiredRepairs, hadAudioWindow: Boolean(question.audioWindow) });
const sameDraft = (left: Draft, right: Draft) => {
  const { requiredRepairs: _leftRepairs, hadAudioWindow: _leftWindow, ...leftFields } = left;
  const { requiredRepairs: _rightRepairs, hadAudioWindow: _rightWindow, ...rightFields } = right;
  return JSON.stringify(leftFields) === JSON.stringify(rightFields);
};

function SectionEditor({ section, active, audio, busy, issues, onSaveTranscript, onSaveQuestion, onPlay }: { section: Section; active: boolean; audio: AudioSet | null; busy: string | null; issues: Map<number, { live: Issue[]; saved: Issue[] }>; onSaveTranscript: (section: Section, transcript: string, baseVersion: string) => Promise<string | null>; onSaveQuestion: (question: Question, draft: Draft, baseVersion: string) => Promise<string | null>; onPlay: (sectionNum: number, question: Question) => void }) {
  const [transcript, setTranscript] = useState(section.transcript);
  const [baseVersion, setBaseVersion] = useState(section.contentUpdatedAt);
  const [stale, setStale] = useState(false);
  const baseline = useRef(section.transcript);
  useEffect(() => {
    if (section.contentUpdatedAt === baseVersion) return;
    if (section.transcript === baseline.current || transcript === section.transcript) {
      baseline.current = section.transcript; setBaseVersion(section.contentUpdatedAt); setStale(false);
    } else setStale(true);
  }, [section.contentUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps -- draft/base intentionally stay pinned
  const save = async () => {
    const version = await onSaveTranscript(section, transcript, baseVersion);
    if (version) { baseline.current = transcript; setBaseVersion(version); setStale(false); }
  };
  return <div id={`alqad-panel-${section.sectionNum}`} className="alqad-section-panel" role="tabpanel" aria-labelledby={`alqad-tab-${section.sectionNum}`} tabIndex={active ? 0 : -1} hidden={!active}><div className="alqad-transcript"><div><label htmlFor={`transcript-${section.sectionNum}`}>Transcript canonical</label><small>Draft token {baseVersion}</small></div>{stale && <div className="alc-banner is-warning" role="alert"><strong>Transcript canonical đã đổi</strong><span>Bản nháp được giữ nhưng Save bị khóa để tránh ghi đè. Chọn “Tải lại & bỏ nháp”.</span></div>}<textarea id={`transcript-${section.sectionNum}`} rows={8} value={transcript} onChange={(event) => setTranscript(event.target.value)} /><button className="adm-btn-secondary" type="button" disabled={Boolean(busy) || stale || transcript === section.transcript || !transcript.trim()} onClick={() => void save()}>{busy === `transcript-${section.sectionNum}` ? 'Đang đọc lại…' : 'Lưu transcript'}</button></div><div className="alqad-question-list">{section.questions.map((question) => <QuestionEditor key={question.clientKey} section={section} audio={audio} question={question} busy={busy} issueSet={question.qNum == null ? undefined : issues.get(question.qNum)} onSave={onSaveQuestion} onPlay={onPlay} />)}</div></div>;
}

function QuestionEditor({ section, audio, question, busy, issueSet, onSave, onPlay }: { section: Section; audio: AudioSet | null; question: Question; busy: string | null; issueSet?: { live: Issue[]; saved: Issue[] }; onSave: (question: Question, draft: Draft, baseVersion: string) => Promise<string | null>; onPlay: (sectionNum: number, question: Question) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftFromQuestion(question));
  const [baseVersion, setBaseVersion] = useState(question.exerciseUpdatedAt);
  const [stale, setStale] = useState(false);
  const baseline = useRef(draftFromQuestion(question));
  useEffect(() => {
    if (question.exerciseUpdatedAt === baseVersion) return;
    const canonical = draftFromQuestion(question);
    if (sameDraft(canonical, baseline.current) || sameDraft(canonical, draft)) {
      baseline.current = canonical; setDraft((current) => ({ ...current, requiredRepairs: canonical.requiredRepairs, hadAudioWindow: canonical.hadAudioWindow })); setBaseVersion(question.exerciseUpdatedAt); setStale(false);
    } else setStale(true);
  }, [question.exerciseUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps -- draft/base intentionally stay pinned
  const set = (field: keyof Draft, value: string) => setDraft((current) => ({ ...current, [field]: value,
    requiredRepairs: current.requiredRepairs.filter((item) => item !== field) }));
  const hasError = [...(issueSet?.live || []), ...(issueSet?.saved || [])].some((issue) => !issue.resolved && issue.severity === 'error');
  const save = async () => {
    const version = await onSave(question, draft, baseVersion);
    if (version) { baseline.current = draft; setBaseVersion(version); setStale(false); }
  };
  const playback = listeningAuditPlayback(audio, section, question.audioWindow);
  const label = question.qNum == null ? question.rawQNum : String(question.qNum);
  const readOnly = !question.editable;
  return <article className={`alqad-question ${hasError ? 'has-error' : ''}`} data-question={question.rawQNum}><header><div><strong>Câu {label}</strong><span>{question.templateKind}</span></div><button className="adm-btn-secondary" type="button" disabled={!playback} onClick={() => onPlay(section.sectionNum, question)}>{playback ? `▶ Nghe window ${question.audioWindow?.start}–${question.audioWindow?.end}s` : question.audioWindow ? 'Timebase/audio chưa xác minh' : 'Chưa có window'}</button></header>{question.identityWarning && <div className="alc-banner is-error" role="alert"><strong>Identity câu hỏi không thể PATCH</strong><span>{question.identityWarning} Sửa q_num tại nguồn/import rồi tải lại; transcript và các card identity hợp lệ vẫn dùng được.</span></div>}{question.repairWarnings.length > 0 && <div className="alc-banner is-warning" role="alert"><strong>Dữ liệu canonical cần sửa</strong><span>{question.repairWarnings.join(' ')}</span></div>}{stale && <div className="alc-banner is-warning" role="alert"><strong>Câu {label} đã đổi ở nguồn canonical</strong><span>Bản nháp được giữ nhưng Save bị khóa. Tải lại để tránh ghi đè thay đổi ở tab khác.</span></div>}{issueSet?.live.length ? <div><small className="alqad-list-label">Live structural</small><IssueList issues={issueSet.live} /></div> : null}{issueSet?.saved.some((issue) => !issue.resolved) ? <div><small className="alqad-list-label">Saved full audit</small><IssueList issues={issueSet.saved} /></div> : null}<div className="alqad-form-grid"><label className="is-wide"><span>Prompt</span><textarea readOnly={readOnly} rows={3} value={draft.prompt} onChange={(event) => set('prompt', event.target.value)} /></label><label><span>Đáp án</span><input readOnly={readOnly} value={draft.answer} onChange={(event) => set('answer', event.target.value)} /></label><label className="is-wide"><span>Alternatives · mỗi dòng một giá trị</span><textarea readOnly={readOnly} rows={3} value={draft.alternatives} onChange={(event) => set('alternatives', event.target.value)} /></label><label className="is-wide"><span>Options · mỗi dòng “A | nội dung”; dùng chuỗi JSON nếu có xuống dòng</span><textarea readOnly={readOnly} rows={Math.max(3, question.options.length)} value={draft.options} onChange={(event) => set('options', event.target.value)} /></label><label className="is-wide"><span>Trap mechanisms · mỗi dòng một giá trị</span><textarea readOnly={readOnly} rows={3} value={draft.traps} onChange={(event) => set('traps', event.target.value)} /></label><label className="is-wide"><span>Giải thích vì sao đúng</span><textarea readOnly={readOnly} rows={3} value={draft.solution} onChange={(event) => set('solution', event.target.value)} /></label><label><span>Window start · giây (để cả hai trống nếu chưa đặt)</span><input readOnly={readOnly} type="number" min="0" step="0.01" value={draft.windowStart} onChange={(event) => set('windowStart', event.target.value)} /></label><label><span>Window end · giây (để cả hai trống nếu chưa đặt)</span><input readOnly={readOnly} type="number" min="0" step="0.01" value={draft.windowEnd} onChange={(event) => set('windowEnd', event.target.value)} /></label></div><footer><small>Draft token {baseVersion}</small><button className="adm-btn-primary" type="button" disabled={Boolean(busy) || stale || readOnly} onClick={() => void save()}>{busy === `question-${question.clientKey}` ? 'Đang đọc lại…' : `Lưu Câu ${label}`}</button></footer></article>;
}
