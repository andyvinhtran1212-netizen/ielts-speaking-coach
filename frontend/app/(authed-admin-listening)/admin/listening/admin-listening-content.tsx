'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  LISTENING_EXERCISE_LABEL, LISTENING_STATUS_LABEL, formatListeningContentDate,
  formatListeningDuration, listeningAudioState, listeningContentListHref,
  normalizeListeningContentFilters, normalizeListeningContentList,
  normalizeListeningExerciseCoverage, normalizeListeningTestAudio,
} from '@/lib/admin-listening-content-model.mjs';

type Status = 'all' | 'draft' | 'published' | 'archived';
type ExerciseType = 'dictation' | 'gist' | 'true_false' | 'mcq';
type Row = { id: string; title: string; status: Exclude<Status, 'all'>; sourceType: string | null; testId: string | null; accent: string | null; cefr: string | null; ieltsSection: number | null; sectionNum: number | null; durationSeconds: number | null; audioStoragePath: string | null; topicTags: string[]; isPremium: boolean; createdAt: string | null; updatedAt: string | null };
type Coverage = { items: Array<{ type: ExerciseType; status: string | null; blockCount: number }>; readyCount: number; presentCount: number; blockCount: number; malformedCount: number; supplementalCount: number };
type CoverageState = { phase: 'loading' } | { phase: 'ready'; value: Coverage } | { phase: 'error'; message: string };
type ParentAudio = { id: string; mode: string | null; ready: boolean };
type ParentAudioState = { phase: 'loading' } | { phase: 'ready'; value: ParentAudio } | { phase: 'error'; message: string };
type Snapshot = { key: string; rows: Row[]; total: number; malformedCount: number; readAt: string };
const PAGE_SIZE = 20;
const FILTERS: Array<{ value: Status; label: string }> = (['all', 'draft', 'published', 'archived'] as Status[]).map((value) => ({ value, label: LISTENING_STATUS_LABEL[value] }));
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusClass = (status: string) => status === 'published' ? 'is-live' : status === 'archived' ? 'is-failed' : 'is-new';
const audioLabel = { ready: 'Sẵn sàng', test_ready: 'Ở test bundle', checking: 'Đang kiểm tra', unknown: 'Không đọc được', rendering: 'Đang render', failed: 'Render lỗi', missing: 'Thiếu audio' } as const;

export function AdminListeningContent() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const filters = normalizeListeningContentFilters({ status: params?.get('status'), page: params?.get('page') }) as { status: Status; page: number };
  const offset = (filters.page - 1) * PAGE_SIZE;
  const key = `${profile.id}:${filters.status}:${offset}`;
  const scope = useRef(key);
  const sequence = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [coverage, setCoverage] = useState<Record<string, CoverageState>>({});
  const [parentAudio, setParentAudio] = useState<Record<string, ParentAudioState>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const current = snapshot?.key === key ? snapshot : null;

  const load = useCallback(async (preserve = true) => {
    const request = ++sequence.current;
    const owner = key;
    setLoading(true); setLoadError(null);
    const query = new URLSearchParams({ status: filters.status, limit: String(PAGE_SIZE), offset: String(offset) });
    try {
      const normalized = normalizeListeningContentList(await window.api.get<unknown>(`/admin/listening/content?${query}`), { limit: PAGE_SIZE, offset, status: filters.status }) as { rows: Row[]; malformedCount: number; total: number } | null;
      if (!normalized) throw new Error('Phản hồi danh sách không đúng contract canonical.');
      if (request !== sequence.current || scope.current !== owner) return;
      const lastPage = Math.max(1, Math.ceil(normalized.total / PAGE_SIZE));
      if (!normalized.rows.length && filters.page > lastPage) {
        router.replace(listeningContentListHref(filters.status, lastPage));
        return;
      }
      const next: Snapshot = { key: owner, rows: normalized.rows, total: normalized.total, malformedCount: normalized.malformedCount, readAt: new Date().toISOString() };
      setSnapshot(next);
      setCoverage(Object.fromEntries(normalized.rows.map((row) => [row.id, { phase: 'loading' }])));
      const testIds = [...new Set(normalized.rows.map((row) => row.testId).filter(Boolean))] as string[];
      setParentAudio(Object.fromEntries(testIds.map((id) => [id, { phase: 'loading' }])));
      await Promise.all([
        ...normalized.rows.map(async (row) => {
        try {
          const result = normalizeListeningExerciseCoverage(await window.api.get<unknown>(`/admin/listening/exercises?content_id=${encodeURIComponent(row.id)}`), row.id) as Coverage | null;
          if (!result) throw new Error('Payload exercise không đúng contract.');
          if (request !== sequence.current || scope.current !== owner) return;
          setCoverage((previous) => ({ ...previous, [row.id]: { phase: 'ready', value: result } }));
        } catch (caught) {
          if (request !== sequence.current || scope.current !== owner) return;
          setCoverage((previous) => ({ ...previous, [row.id]: { phase: 'error', message: messageOf(caught) } }));
        }
        }),
        ...testIds.map(async (testId) => {
          try {
            const result = normalizeListeningTestAudio(await window.api.get<unknown>(`/admin/listening/tests/${encodeURIComponent(testId)}`), testId) as ParentAudio | null;
            if (!result) throw new Error('Payload test bundle không đúng contract.');
            if (request !== sequence.current || scope.current !== owner) return;
            setParentAudio((previous) => ({ ...previous, [testId]: { phase: 'ready', value: result } }));
          } catch (caught) {
            if (request !== sequence.current || scope.current !== owner) return;
            setParentAudio((previous) => ({ ...previous, [testId]: { phase: 'error', message: messageOf(caught) } }));
          }
        }),
      ]);
    } catch (caught) {
      if (request === sequence.current && scope.current === owner) setLoadError(`${preserve && current ? 'Không thể làm mới — đang giữ snapshot trước. ' : ''}${messageOf(caught)}`);
    } finally {
      if (request === sequence.current && scope.current === owner) setLoading(false);
    }
  }, [current, filters.page, filters.status, key, offset, router]);

  useEffect(() => {
    scope.current = key; setSnapshot(null); setCoverage({}); setParentAudio({}); setLoadError(null); void load(false);
    return () => { sequence.current += 1; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseStatus = (status: Status) => router.push(listeningContentListHref(status, 1));
  const maxPage = current ? Math.max(1, Math.ceil(current.total / PAGE_SIZE)) : 1;

  return <main className="alc-shell">
    <header className="alc-hero">
      <div><p className="alc-eyebrow">Listening · Content operations</p><h1>Kho nội dung Listening</h1><p>Đối chiếu trạng thái phát hành, nguồn audio và độ phủ bốn dạng bài trên dữ liệu canonical trước khi mở từng editor.</p></div>
      <div className="alc-hero__actions"><a href="/admin/listening/tests"><span>Cambridge tests</span><span aria-hidden="true">→</span></a><a href="/listening/tests" target="_blank" rel="noreferrer"><span>Xem phía học viên</span><span aria-hidden="true">↗</span></a></div>
    </header>

    <section className="alc-flow" aria-labelledby="alc-flow-title"><div><p className="alc-eyebrow">Authoring map</p><h2 id="alc-flow-title">Một dòng nội dung, bốn lớp kiểm định</h2><p>Mở detail để đọc transcript và trạng thái; từng editor giữ nguyên identity <code>content_id</code>.</p></div><ol><li><span>1</span><strong>Audio</strong><small>file, thời lượng, nguồn</small></li><li><span>2</span><strong>Metadata</strong><small>accent, CEFR, section</small></li><li><span>3</span><strong>Exercises</strong><small>dictation, gist, T/F, MCQ</small></li><li><span>4</span><strong>Publish</strong><small>draft → learner library</small></li></ol></section>

    <section className="alc-library" aria-labelledby="alc-library-title">
      <div className="alc-section-head"><div><p>Canonical inventory</p><h2 id="alc-library-title">Nội dung đã lưu</h2><span>{current ? `${current.total} mục · đọc lúc ${formatListeningContentDate(current.readAt)}` : 'Đang đọc từ backend…'}</span></div><button className="btn-secondary" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
      <nav className="alc-filters" aria-label="Lọc trạng thái">{FILTERS.map((item) => <button type="button" key={item.value} aria-current={filters.status === item.value ? 'page' : undefined} onClick={() => chooseStatus(item.value)}>{item.label}</button>)}</nav>
      {loadError && <div className="alc-banner is-error" role="alert"><strong>Không tải được inventory.</strong><span>{loadError}</span></div>}
      {!!current?.malformedCount && <div className="alc-banner is-warning" role="status"><strong>Dữ liệu cần kiểm tra</strong><span>Đã loại {current.malformedCount} dòng sai contract hoặc không khớp bộ lọc; tổng server không bị thay bằng số đã lọc.</span></div>}
      {loading && !current && <div className="alc-empty" role="status">Đang đọc kho nội dung…</div>}
      {current && !current.rows.length && <div className="alc-empty"><strong>Không có nội dung ở trạng thái này</strong><span>Thử bộ lọc khác hoặc mở Cambridge tests để import dữ liệu.</span></div>}
      {!!current?.rows.length && <div className="alc-table-wrap" role="region" aria-label="Bảng nội dung Listening" tabIndex={0}><table className="alc-table"><thead><tr><th>Nội dung</th><th>Phân loại</th><th>Audio</th><th>Trạng thái</th><th>Exercises</th><th>Thao tác</th></tr></thead><tbody>{current.rows.map((row) => {
        const testAudio = row.testId ? parentAudio[row.testId] : undefined;
        const audio = listeningAudioState(row, testAudio?.phase === 'ready' ? testAudio.value : testAudio?.phase === 'error' ? null : undefined) as keyof typeof audioLabel;
        const rowCoverage = coverage[row.id];
        return <tr key={row.id} data-content-id={row.id}><td data-label="Nội dung"><a className="alc-title" href={`/admin/listening/content/${encodeURIComponent(row.id)}`}>{row.title}</a><code>{row.id}</code><small>{row.topicTags.slice(0, 3).join(' · ') || 'Chưa có topic tags'}</small></td><td data-label="Phân loại"><strong>{[row.cefr, row.accent].filter(Boolean).join(' · ') || 'Chưa phân loại'}</strong><small>{row.ieltsSection ? `IELTS Section ${row.ieltsSection}` : row.sectionNum ? `Test section ${row.sectionNum}` : row.sourceType || 'Không rõ nguồn'}</small>{row.isPremium && <span className="alc-premium">Premium</span>}</td><td data-label="Audio"><span className={`alc-audio is-${audio}`}>{audioLabel[audio]}</span><small>{row.testId && audio !== 'ready' ? `test ${row.testId}` : formatListeningDuration(row.durationSeconds)}</small></td><td data-label="Trạng thái"><span className={`adm-status-pill ${statusClass(row.status)}`}>{LISTENING_STATUS_LABEL[row.status]}</span><time dateTime={row.updatedAt || row.createdAt || undefined}>{formatListeningContentDate(row.updatedAt || row.createdAt)}</time></td><td data-label="Exercises"><ExerciseCoverage state={rowCoverage} /></td><td data-label="Thao tác"><div className="alc-actions"><a href={`/admin/listening/content/${encodeURIComponent(row.id)}`}>Chi tiết</a><a href={`/admin/listening/content/${encodeURIComponent(row.id)}/edit`}>Metadata</a><a href={`/pages/admin/listening/segments.html?content_id=${encodeURIComponent(row.id)}`}>Dict</a><a href={`/pages/admin/listening/gist.html?content_id=${encodeURIComponent(row.id)}`}>Gist</a><a href={`/pages/admin/listening/tf.html?content_id=${encodeURIComponent(row.id)}`}>T/F</a><a href={`/pages/admin/listening/mcq.html?content_id=${encodeURIComponent(row.id)}`}>MCQ</a></div></td></tr>;
      })}</tbody></table></div>}
      {current && current.total > PAGE_SIZE && <nav className="alc-pagination" aria-label="Phân trang nội dung"><button type="button" disabled={loading || filters.page === 1} onClick={() => router.push(listeningContentListHref(filters.status, filters.page - 1))}>← Trước</button><span>Trang {filters.page}/{maxPage} · {current.total} nội dung</span><button type="button" disabled={loading || offset + PAGE_SIZE >= current.total} onClick={() => router.push(listeningContentListHref(filters.status, filters.page + 1))}>Sau →</button></nav>}
    </section>
    <a className="alc-rollback" href="/pages/admin/listening/index.html">Mở bản HTML rollback ↗</a>
  </main>;
}

function ExerciseCoverage({ state }: { state?: CoverageState }) {
  if (!state || state.phase === 'loading') return <div className="alc-exercises is-loading" role="status">Đang kiểm tra…</div>;
  if (state.phase === 'error') return <div className="alc-exercises is-error" title={state.message}><strong>Không đọc được</strong><small>Không đồng nghĩa “chưa có”</small></div>;
  return <div className="alc-exercises"><div>{state.value.items.map((item) => <span className={item.status ? statusClass(item.status) : 'is-missing'} key={item.type} title={`${LISTENING_EXERCISE_LABEL[item.type]}: ${item.status || 'chưa có'} · ${item.blockCount} block`}>{LISTENING_EXERCISE_LABEL[item.type]}</span>)}</div><small>{state.value.presentCount}/4 loại · {state.value.blockCount} block · {state.value.readyCount}/4 published{state.value.supplementalCount ? ` · ${state.value.supplementalCount} mini` : ''}{state.value.malformedCount ? ` · ${state.value.malformedCount} lỗi contract` : ''}</small></div>;
}
