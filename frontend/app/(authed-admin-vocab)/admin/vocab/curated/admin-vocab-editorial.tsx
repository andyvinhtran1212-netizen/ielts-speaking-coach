'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  REVIEW_TYPES,
  buildEditorialDiff,
  editorialCatalogQuery,
  normalizeEditorialDetail,
  normalizeEditorialListPayload,
  safeEditorialSourceHref,
} from '@/lib/admin-vocab-editorial-model.mjs';

type GateState = 'pending' | 'approved' | 'changes_requested';
type ReviewGate = {
  states: Record<string, GateState>;
  pendingReviewTypes: string[];
  hasDistinctReviewers: boolean;
  reviewsReady: boolean;
};
type VersionSummary = {
  id: string; unitId: string; versionNumber: number; status: string;
  changeNote: string; authoredBy: string; publishedAt: string; updatedAt: string;
  taskCount: number; dimensions: string[]; reviewCount: number; reviewGate: ReviewGate;
};
type UnitRow = {
  id: string; slug: string; displayHeadword: string; unitType: string;
  targetLevel: string; status: string; currentPublishedVersionId: string;
  updatedAt: string; versions: VersionSummary[];
};
type Review = {
  id: string; versionId: string; reviewerId: string; reviewType: string;
  decision: 'approved' | 'changes_requested'; notes: string; updatedAt: string;
};
type Task = {
  id: string; sequence: number; taskType: string; dimension: string; prompt: string;
  options: unknown[]; answerKey: Record<string, unknown>; explanationVi: string; status: string;
};
type VersionDetail = {
  id: string; versionNumber: number; status: string; content: Record<string, unknown>;
  sources: Array<Record<string, unknown>>; changeNote: string; authoredBy: string;
  publishedAt: string; updatedAt: string; tasks: Task[]; reviews: Review[]; reviewGate: ReviewGate;
};
type Detail = {
  unit: Record<string, unknown> & {
    id: string; displayHeadword: string; slug: string; currentPublishedVersionId: string;
  };
  versions: VersionDetail[];
  events: Array<Record<string, unknown>>;
  eventsTotal: number;
  eventsHasMore: boolean;
};
type Notice = { kind: 'success' | 'error' | 'warning'; message: string };
type Tab = 'preview' | 'diff' | 'tasks' | 'reviews' | 'history';

const REVIEW_LABELS: Record<string, string> = {
  language: 'Ngôn ngữ', pedagogy: 'Sư phạm', assessment: 'Đánh giá',
};
const STATE_LABELS: Record<string, string> = {
  pending: 'Chờ duyệt', approved: 'Đã duyệt', changes_requested: 'Cần sửa',
  draft: 'Draft', in_review: 'In review', published: 'Published', archived: 'Archived',
};
const CONTENT_LABELS: Record<string, string> = {
  title_vi: 'Tiêu đề', learning_goal_vi: 'Mục tiêu học', meaning_vi: 'Nghĩa dùng',
  usage_vi: 'Cách dùng', contrast_vi: 'Phân biệt', why_vietnamese_learners_struggle: 'Vấn đề của học viên Việt',
  construction: 'Construction', communicative_function: 'Chức năng giao tiếp',
  production_prompt_vi: 'Prompt tạo câu', memory_hook_vi: 'Móc ghi nhớ', examples: 'Ví dụ',
};
const CATALOG_PAGE_SIZE = 100;
type LoadResult = 'ok' | 'stale' | 'error';

const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value || 'lỗi không xác định');
const formatDate = (value: unknown) => {
  const date = new Date(typeof value === 'string' ? value : '');
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
};
const displayValue = (value: unknown) => {
  if (value == null || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

function GatePills({ gate }: { gate: ReviewGate }) {
  return <div className="avv-editorial-gates" aria-label="Editorial gates">{REVIEW_TYPES.map((type) => {
    const state = gate.states[type];
    return <span className={`avv-chip is-${state === 'approved' ? 'teal' : state === 'changes_requested' ? 'warning' : 'muted'}`} key={type}>{REVIEW_LABELS[type]} · {STATE_LABELS[state]}</span>;
  })}</div>;
}

export function AdminVocabEditorial() {
  const profile = useAdminProfile();
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [inbox, setInbox] = useState('all');
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>('preview');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reviewType, setReviewType] = useState('language');
  const [reviewNotes, setReviewNotes] = useState('');
  const [validation, setValidation] = useState<{ versionId: string; valid: boolean; errors: string[] } | null>(null);
  const [rollbackVersion, setRollbackVersion] = useState<VersionDetail | null>(null);
  const catalogSequence = useRef(0);
  const detailSequence = useRef(0);
  const rollbackCancelRef = useRef<HTMLButtonElement>(null);
  const rollbackTriggerRef = useRef<HTMLButtonElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const busyRef = useRef(busy);
  const reviewContextRef = useRef({ accountId: profile.id, versionId: '' });
  const accountRef = useRef(profile.id);
  accountRef.current = profile.id;
  busyRef.current = busy;

  const loadDetail = useCallback(async (unitId: string, preferredVersionId = ''): Promise<LoadResult> => {
    const requestId = ++detailSequence.current;
    const account = profile.id;
    setDetailLoading(true); setNotice(null); setError(null);
    try {
      const raw = await window.api.get<unknown>(`/admin/vocabulary/editorial/units/${encodeURIComponent(unitId)}`);
      const payload = normalizeEditorialDetail(raw) as Detail | null;
      if (!payload) throw new Error('Backend trả về editorial bundle không đúng contract.');
      if (requestId !== detailSequence.current || account !== accountRef.current) return 'stale';
      const chosen = payload.versions.find((version) => version.id === preferredVersionId)
        || payload.versions.find((version) => ['draft', 'in_review'].includes(version.status))
        || payload.versions[0];
      const nextVersionId = chosen?.id || '';
      const reviewContextChanged = reviewContextRef.current.accountId !== account
        || reviewContextRef.current.versionId !== nextVersionId;
      reviewContextRef.current = { accountId: account, versionId: nextVersionId };
      setDetail(payload); setSelectedUnitId(unitId); setSelectedVersionId(nextVersionId);
      setValidation(null); setRollbackVersion(null);
      if (reviewContextChanged) { setReviewNotes(''); setReviewType('language'); }
      return 'ok';
    } catch (caught) {
      if (requestId === detailSequence.current && account === accountRef.current) {
        setDetail(null); setError(`Không tải được unit editorial: ${messageOf(caught)}`);
      }
      return requestId === detailSequence.current && account === accountRef.current ? 'error' : 'stale';
    } finally {
      if (requestId === detailSequence.current && account === accountRef.current) setDetailLoading(false);
    }
  }, [profile.id]);

  const loadCatalog = useCallback(async (nextStatus = status, nextOffset = offset, preferredUnitId = selectedUnitId, preferredVersionId = selectedVersionId): Promise<LoadResult> => {
    const query = editorialCatalogQuery({ status: nextStatus, offset: nextOffset, limit: CATALOG_PAGE_SIZE });
    if (!query) { setError('Bộ lọc catalog không hợp lệ.'); setLoading(false); return 'error'; }
    const requestId = ++catalogSequence.current;
    const account = profile.id;
    setLoading(true); setError(null);
    try {
      const raw = await window.api.get<unknown>(`/admin/vocabulary/editorial/units?${query}`);
      const payload = normalizeEditorialListPayload(raw) as { items: UnitRow[]; total: number } | null;
      if (!payload) throw new Error('Backend trả về catalog không đúng contract.');
      if (requestId !== catalogSequence.current || account !== accountRef.current) return 'stale';
      setUnits(payload.items); setTotal(payload.total);
      const selected = payload.items.find((unit) => unit.id === preferredUnitId) || payload.items[0];
      if (selected) {
        const detailResult = await loadDetail(selected.id, selected.id === preferredUnitId ? preferredVersionId : '');
        if (detailResult !== 'ok') return detailResult;
      } else {
        setDetail(null); setSelectedUnitId(''); setSelectedVersionId('');
        setDetailLoading(false);
      }
      return 'ok';
    } catch (caught) {
      if (requestId === catalogSequence.current && account === accountRef.current) {
        setUnits([]); setTotal(0); setDetail(null);
        setError(`Không tải được Curated editorial catalog: ${messageOf(caught)}`);
      }
      return requestId === catalogSequence.current && account === accountRef.current ? 'error' : 'stale';
    } finally {
      if (requestId === catalogSequence.current && account === accountRef.current) setLoading(false);
    }
  }, [loadDetail, offset, profile.id, selectedUnitId, selectedVersionId, status]);

  useEffect(() => {
    if (!rollbackVersion) return undefined;
    const trigger = rollbackTriggerRef.current;
    rollbackCancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) setRollbackVersion(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); trigger?.focus(); };
  }, [rollbackVersion]);

  useEffect(() => {
    void loadCatalog(status, offset, '', '');
    return () => { catalogSequence.current += 1; detailSequence.current += 1; };
  // loadCatalog deliberately reads the current selection for mutation readback;
  // initial/filter loads pass explicit empty selection and only depend on status/account.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, status, offset]);

  const selectedVersion = detail?.versions.find((version) => version.id === selectedVersionId) || null;
  const publishedVersion = detail?.versions.find((version) => version.id === detail.unit.currentPublishedVersionId) || null;
  const baseVersion = publishedVersion && selectedVersion && publishedVersion.versionNumber < selectedVersion.versionNumber
    ? publishedVersion
    : [...(detail?.versions || [])]
      .filter((version) => version.versionNumber < (selectedVersion?.versionNumber || 0))
      .sort((left, right) => right.versionNumber - left.versionNumber)[0] || null;
  const diff = useMemo(() => buildEditorialDiff(baseVersion, selectedVersion), [baseVersion, selectedVersion]);
  const visibleUnits = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi');
    return units.filter((unit) => {
      const matchesSearch = !needle || `${unit.displayHeadword} ${unit.slug}`.toLocaleLowerCase('vi').includes(needle);
      if (!matchesSearch || inbox === 'all') return matchesSearch;
      const candidates = unit.versions.filter((version) => ['draft', 'in_review'].includes(version.status));
      if (inbox === 'ready') return candidates.some((version) => version.reviewGate.reviewsReady);
      return candidates.some((version) => version.reviewGate.states[inbox] !== 'approved');
    });
  }, [inbox, search, units]);

  const chooseUnit = (unit: UnitRow) => {
    const candidate = unit.versions.find((version) => ['draft', 'in_review'].includes(version.status)) || unit.versions[0];
    void loadDetail(unit.id, candidate?.id || '');
  };

  const refreshCanonical = async (message: string) => {
    const result = await loadCatalog(status, offset, selectedUnitId, selectedVersionId);
    if (result !== 'ok') {
      if (profile.id === accountRef.current) {
        setNotice({ kind: 'warning', message: 'Mutation đã được backend nhận nhưng canonical readback chưa hoàn tất. Hãy tải lại trước khi thao tác tiếp.' });
      }
      return result;
    }
    setNotice({ kind: 'success', message });
    return result;
  };

  const validate = async () => {
    if (!selectedVersion || busy) return;
    setBusy(true); setNotice(null);
    try {
      const raw = await window.api.post<unknown>(`/admin/vocabulary/versions/${encodeURIComponent(selectedVersion.id)}/validate`, {});
      const value = raw as Record<string, unknown>;
      if (!value || value.version_id !== selectedVersion.id || typeof value.valid !== 'boolean' || !Array.isArray(value.errors)) {
        throw new Error('Validation ACK không đúng contract.');
      }
      const result = { versionId: selectedVersion.id, valid: value.valid, errors: value.errors.filter((item): item is string => typeof item === 'string') };
      setValidation(result);
      setNotice({ kind: result.valid ? 'success' : 'warning', message: result.valid ? 'Content gate hợp lệ; vẫn cần đủ ba reviewer độc lập.' : `Content gate còn ${result.errors.length} lỗi.` });
    } catch (caught) { setNotice({ kind: 'error', message: `Không validate được version: ${messageOf(caught)}` }); }
    finally { setBusy(false); }
  };

  const review = async (decision: 'approved' | 'changes_requested') => {
    if (!selectedVersion || busy) return;
    const otherApproval = selectedVersion.reviews.find((item) => item.reviewerId === profile.id && item.reviewType !== reviewType && item.decision === 'approved');
    if (decision === 'approved' && otherApproval) {
      setNotice({ kind: 'error', message: `Bạn đã duyệt cửa ${REVIEW_LABELS[otherApproval.reviewType]}; ba cửa bắt buộc ba reviewer khác nhau.` });
      return;
    }
    if (decision === 'changes_requested' && !reviewNotes.trim()) {
      setNotice({ kind: 'error', message: 'Yêu cầu chỉnh sửa phải có ghi chú hành động cụ thể.' });
      return;
    }
    setBusy(true); setNotice(null);
    try {
      await window.api.post<unknown>(`/admin/vocabulary/versions/${encodeURIComponent(selectedVersion.id)}/reviews`, {
        review_type: reviewType, decision, notes: reviewNotes.trim() || null,
      });
      setReviewNotes('');
      await refreshCanonical(decision === 'approved' ? `Đã duyệt cửa ${REVIEW_LABELS[reviewType]} và đọc lại trạng thái chuẩn.` : `Đã gửi yêu cầu sửa cho cửa ${REVIEW_LABELS[reviewType]}.`);
    } catch (caught) { setNotice({ kind: 'error', message: `Không lưu được review: ${messageOf(caught)}` }); }
    finally { setBusy(false); }
  };

  const publish = async () => {
    if (!selectedVersion || busy) return;
    if (validation?.versionId !== selectedVersion.id || !validation.valid || !selectedVersion.reviewGate.reviewsReady) {
      setNotice({ kind: 'error', message: 'Chỉ publish sau khi validation hiện tại hợp lệ và đủ ba reviewer độc lập.' });
      return;
    }
    setBusy(true); setNotice(null);
    try {
      await window.api.post<unknown>(`/admin/vocabulary/versions/${encodeURIComponent(selectedVersion.id)}/publish`, {});
      await refreshCanonical(`Đã publish version ${selectedVersion.versionNumber} và xác nhận lại từ backend.`);
    } catch (caught) { setNotice({ kind: 'error', message: `Không publish được version: ${messageOf(caught)}` }); }
    finally { setBusy(false); }
  };

  const rollback = async () => {
    if (!detail || !rollbackVersion || busy) return;
    setBusy(true); setNotice(null);
    try {
      await window.api.post<unknown>(`/admin/vocabulary/units/${encodeURIComponent(detail.unit.id)}/rollback`, { version_id: rollbackVersion.id });
      const versionNumber = rollbackVersion.versionNumber;
      setRollbackVersion(null);
      const readback = await refreshCanonical(`Đã rollback về version ${versionNumber} và xác nhận lại current version.`);
      if (readback === 'ok') requestAnimationFrame(() => detailHeadingRef.current?.focus());
    } catch (caught) { setNotice({ kind: 'error', message: `Không rollback được unit: ${messageOf(caught)}` }); }
    finally { setBusy(false); }
  };

  return <main className="avv-shell avv-console-shell avv-editorial-shell">
    <header className="avv-stats-hero">
      <div><a href="/admin/vocab">← Vocabulary workspace</a><p className="avv-eyebrow">Curated content operations</p><h1>Learning-unit editorial</h1><p>Review inbox, preview và diff của immutable versions. Mọi mutation chỉ được coi là thành công sau canonical readback.</p></div>
      <div className="avv-console-count"><span>Trang hiện tại</span><strong>{visibleUnits.length}/{units.length}</strong><small>{total} unit toàn catalog</small></div>
    </header>

    <section className="avv-editorial-toolbar" aria-label="Bộ lọc editorial">
      <label>Tìm unit<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Headword hoặc slug" /></label>
      <label>Unit status<select value={status} disabled={loading || busy} onChange={(event) => { setOffset(0); setStatus(event.target.value); }}><option value="">Tất cả</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
      <div className="avv-editorial-filter"><label>Reviewer inbox<select value={inbox} aria-describedby={total > units.length ? 'avv-editorial-inbox-scope' : undefined} onChange={(event) => setInbox(event.target.value)}><option value="all">Tất cả unit</option><option value="language">Chờ Language</option><option value="pedagogy">Chờ Pedagogy</option><option value="assessment">Chờ Assessment</option><option value="ready">Đủ review gates</option></select></label>{total > units.length ? <small id="avv-editorial-inbox-scope">Lọc inbox áp dụng cho trang đang tải.</small> : null}</div>
      <button className="btn-secondary" type="button" disabled={loading || busy} onClick={() => void loadCatalog()}>{loading ? 'Đang tải…' : 'Làm mới'}</button>
      <div className="avv-editorial-pager" aria-label="Phân trang catalog"><button className="btn-secondary" type="button" disabled={loading || busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - CATALOG_PAGE_SIZE))}>← Trước</button><span>{total ? `${offset + 1}–${Math.min(offset + units.length, total)} / ${total}` : '0 / 0'}</span><button className="btn-secondary" type="button" disabled={loading || busy || offset + units.length >= total} onClick={() => setOffset(offset + CATALOG_PAGE_SIZE)}>Sau →</button></div>
    </section>
    {notice ? <p className={`avv-banner is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p> : null}
    {error ? <p className="avv-banner is-error" role="alert">{error}</p> : null}

    <div className="avv-editorial-layout">
      <aside className="avv-editorial-list" aria-label="Danh sách learning units">
        <header><div><p className="avv-eyebrow">Reviewer inbox</p><h2>Learning units</h2></div><span>{visibleUnits.length}</span></header>
        {loading && !units.length ? <div className="avv-state">Đang tải catalog…</div> : visibleUnits.length === 0 ? <div className="avv-state">Không có unit phù hợp.</div> : visibleUnits.map((unit) => {
          const candidate = unit.versions.find((version) => ['draft', 'in_review'].includes(version.status)) || unit.versions[0];
          return <button className={unit.id === selectedUnitId ? 'is-active' : ''} aria-pressed={unit.id === selectedUnitId} disabled={busy} type="button" key={unit.id} onClick={() => chooseUnit(unit)}>
            <span className="avv-editorial-list__title"><strong>{unit.displayHeadword}</strong><small>{unit.slug} · {unit.targetLevel}</small></span>
            <span className={`avv-chip is-${candidate?.reviewGate.reviewsReady ? 'teal' : candidate?.reviewGate.pendingReviewTypes.length ? 'warning' : 'muted'}`}>{candidate ? `v${candidate.versionNumber} · ${STATE_LABELS[candidate.status] || candidate.status}` : 'Chưa có version'}</span>
            {candidate ? <GatePills gate={candidate.reviewGate} /> : null}
          </button>;
        })}
      </aside>

      <section className="avv-editorial-detail">
        {detailLoading ? <div className="avv-state">Đang tải canonical editorial bundle…</div> : !detail || !selectedVersion ? <div className="avv-state">Chọn một unit để xem version, diff và review gates.</div> : <>
          <header className="avv-editorial-detail__head"><div><p className="avv-eyebrow">{detail.unit.slug}</p><h2 ref={detailHeadingRef} tabIndex={-1}>{detail.unit.displayHeadword}</h2><p>{String(detail.unit.sense_key || '')} · {String(detail.unit.construction_key || '')}</p></div><div><label>Version<select value={selectedVersionId} disabled={busy} onChange={(event) => { setSelectedVersionId(event.target.value); setValidation(null); setRollbackVersion(null); setReviewNotes(''); setReviewType('language'); }}>{detail.versions.map((version) => <option key={version.id} value={version.id}>v{version.versionNumber} · {STATE_LABELS[version.status] || version.status}</option>)}</select></label><span className={`adm-status-pill is-${selectedVersion.status === 'published' ? 'live' : selectedVersion.status === 'in_review' ? 'warning' : 'inactive'}`}>{STATE_LABELS[selectedVersion.status] || selectedVersion.status}</span></div></header>
          <div className="avv-editorial-version-meta"><span>Change note<strong>{selectedVersion.changeNote || 'Không có ghi chú'}</strong></span><span>Cập nhật<strong>{formatDate(selectedVersion.updatedAt)}</strong></span><span>Task<strong>{selectedVersion.tasks.filter((task) => task.status === 'active').length}</strong></span></div>
          <GatePills gate={selectedVersion.reviewGate} />

          <nav className="avv-native-tabs" aria-label="Editorial detail tabs">{([
            ['preview', 'Preview'], ['diff', `Diff (${diff.length})`], ['tasks', `Tasks (${selectedVersion.tasks.length})`], ['reviews', 'Reviews'], ['history', 'History'],
          ] as Array<[Tab, string]>).map(([key, label]) => <button className={tab === key ? 'is-active' : ''} aria-pressed={tab === key} type="button" key={key} onClick={() => setTab(key)}>{label}</button>)}</nav>

          {tab === 'preview' ? <section className="avv-editorial-preview"><header><div><p className="avv-eyebrow">Learner-facing preview</p><h3>{String(selectedVersion.content.title_vi || detail.unit.displayHeadword)}</h3></div><span>v{selectedVersion.versionNumber}</span></header><dl>{Object.entries(selectedVersion.content).map(([key, value]) => <div key={key}><dt>{CONTENT_LABELS[key] || key}</dt><dd><pre>{displayValue(value)}</pre></dd></div>)}</dl><footer><strong>Nguồn biên tập</strong>{selectedVersion.sources.length ? <ol>{selectedVersion.sources.map((source, index) => { const rawUrl = String(source.url || ''); const href = safeEditorialSourceHref(rawUrl); const label = String(source.title || rawUrl || `Nguồn ${index + 1}`); return <li key={`${rawUrl}-${index}`}>{href ? <a href={href} target="_blank" rel="noreferrer">{label}</a> : <span>{label} · chỉ chấp nhận HTTPS {rawUrl ? <code>{rawUrl}</code> : null}</span>}</li>; })}</ol> : <p>Chưa có nguồn.</p>}</footer></section> : null}

          {tab === 'diff' ? <section className="avv-editorial-diff"><header><div><p className="avv-eyebrow">Immutable version diff</p><h3>{baseVersion ? `v${baseVersion.versionNumber} → v${selectedVersion.versionNumber}` : `Version đầu tiên · v${selectedVersion.versionNumber}`}</h3></div></header>{diff.length === 0 ? <div className="avv-state">Không có thay đổi so với version nền.</div> : diff.map((entry: { field: string; before: string; after: string }) => <article key={entry.field}><h4>{entry.field}</h4>{entry.field === 'tasks' ? <details><summary>Mở diff task và đáp án riêng</summary><div><section><span>Trước</span><pre>{entry.before}</pre></section><section><span>Sau</span><pre>{entry.after}</pre></section></div></details> : <div><section><span>Trước</span><pre>{entry.before}</pre></section><section><span>Sau</span><pre>{entry.after}</pre></section></div>}</article>)}</section> : null}

          {tab === 'tasks' ? <section className="avv-editorial-tasks">{selectedVersion.tasks.map((task) => <article key={task.id}><header><span>#{task.sequence}</span><div><strong>{task.taskType}</strong><small>{task.dimension} · {task.status}</small></div></header><p>{task.prompt}</p><details><summary>Đáp án riêng & giải thích</summary><pre>{JSON.stringify(task.answerKey, null, 2)}</pre><p>{task.explanationVi}</p></details></article>)}</section> : null}

          {tab === 'reviews' ? <section className="avv-editorial-reviews"><div className="avv-editorial-review-grid">{REVIEW_TYPES.map((type) => <article key={type}><span className={`avv-chip is-${selectedVersion.reviewGate.states[type] === 'approved' ? 'teal' : selectedVersion.reviewGate.states[type] === 'changes_requested' ? 'warning' : 'muted'}`}>{STATE_LABELS[selectedVersion.reviewGate.states[type]]}</span><h3>{REVIEW_LABELS[type]}</h3>{selectedVersion.reviews.filter((review) => review.reviewType === type).length ? selectedVersion.reviews.filter((review) => review.reviewType === type).map((review) => <div key={review.id}><strong>{review.decision === 'approved' ? 'Approved' : 'Changes requested'}</strong><code>{review.reviewerId || 'reviewer đã xoá'}</code><p>{review.notes || 'Không có ghi chú.'}</p><small>{formatDate(review.updatedAt)}</small></div>) : <p>Chưa có reviewer.</p>}</article>)}</div>{['draft', 'in_review'].includes(selectedVersion.status) ? <form className="avv-editorial-review-form" onSubmit={(event) => { event.preventDefault(); void review('approved'); }}><div><p className="avv-eyebrow">Submit review</p><h3>Quyết định chuyên môn</h3><p>Mỗi reviewer chỉ nên sở hữu một cửa. Database vẫn xác minh ba người khác nhau khi publish.</p></div><label>Cửa review<select value={reviewType} disabled={busy} onChange={(event) => setReviewType(event.target.value)}>{REVIEW_TYPES.map((type) => <option key={type} value={type}>{REVIEW_LABELS[type]}</option>)}</select></label><label className="is-wide">Ghi chú<textarea value={reviewNotes} disabled={busy} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Bằng chứng, lỗi cần sửa hoặc lý do duyệt…" /></label><div className="avv-editorial-review-actions"><button className="btn-danger" type="button" disabled={busy} onClick={() => void review('changes_requested')}>Yêu cầu sửa</button><button className="btn-primary" type="submit" disabled={busy}>Approve</button></div></form> : null}</section> : null}

          {tab === 'history' ? <section className="avv-editorial-history"><h3>Publication events</h3>{detail.events.length ? <><ol>{detail.events.map((event, index) => <li key={String(event.id || index)}><span className={`avv-chip is-${event.action === 'publish' ? 'teal' : 'warning'}`}>{String(event.action || 'event')}</span><strong>v{detail.versions.find((version) => version.id === event.version_id)?.versionNumber || '?'}</strong><time>{formatDate(event.created_at)}</time><code>{String(event.actor_id || 'system')}</code></li>)}</ol>{detail.eventsHasMore ? <p className="avv-banner is-warning">Đang hiển thị {detail.events.length}/{detail.eventsTotal} event mới nhất.</p> : null}</> : <div className="avv-state">Chưa có publication event.</div>}</section> : null}

          <footer className="avv-editorial-actions"><div><button className="btn-secondary" type="button" disabled={busy} onClick={() => void validate()}>{busy ? 'Đang xử lý…' : 'Validate content gate'}</button>{validation?.versionId === selectedVersion.id ? <span className={`avv-chip is-${validation.valid ? 'teal' : 'warning'}`}>{validation.valid ? 'Validation pass' : `${validation.errors.length} lỗi`}</span> : <span className="avv-chip is-muted">Chưa validate phiên này</span>}</div><div>{selectedVersion.status === 'published' && selectedVersion.id !== detail.unit.currentPublishedVersionId ? <button ref={rollbackTriggerRef} className="btn-danger" type="button" disabled={busy} onClick={() => setRollbackVersion(selectedVersion)}>Rollback về v{selectedVersion.versionNumber}</button> : null}{['draft', 'in_review'].includes(selectedVersion.status) ? <button className="btn-primary" type="button" disabled={busy || validation?.versionId !== selectedVersion.id || !validation.valid || !selectedVersion.reviewGate.reviewsReady} onClick={() => void publish()}>Publish version</button> : null}</div></footer>
          {validation?.versionId === selectedVersion.id && !validation.valid ? <div className="avv-banner is-warning"><strong>Content gate chưa đạt</strong><ul>{validation.errors.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {rollbackVersion ? <section className="avv-editorial-confirm" role="group" aria-labelledby="avv-rollback-title"><div><p className="avv-eyebrow">Xác nhận rollback</p><h3 id="avv-rollback-title">Đưa learner traffic về v{rollbackVersion.versionNumber}?</h3><p>Attempt và publication history không bị xoá. Backend chỉ đổi current published version sau khi xác minh version thuộc đúng unit.</p></div><div><button ref={rollbackCancelRef} className="btn-secondary" type="button" disabled={busy} onClick={() => setRollbackVersion(null)}>Hủy</button><button className="btn-danger" type="button" disabled={busy} onClick={() => void rollback()}>{busy ? 'Đang xác minh…' : 'Xác nhận rollback'}</button></div></section> : null}
        </>}
      </section>
    </div>
  </main>;
}
