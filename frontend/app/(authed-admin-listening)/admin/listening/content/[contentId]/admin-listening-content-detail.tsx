'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  LISTENING_EXERCISE_LABEL, LISTENING_STATUS_LABEL, formatListeningContentDate,
  formatListeningDuration, listeningAudioState, normalizeListeningContentDetail,
  normalizeListeningExerciseCoverage, normalizeListeningStatusReadback,
  normalizeListeningTestAudio,
} from '@/lib/admin-listening-content-model.mjs';

type Status = 'draft' | 'published' | 'archived';
type Content = { id: string; title: string; status: Status; sourceType: string | null; testId: string | null; accent: string | null; cefr: string | null; ieltsSection: number | null; sectionNum: number | null; durationSeconds: number | null; audioStoragePath: string | null; audioSignedUrl: string | null; topicTags: string[]; isPremium: boolean; createdAt: string | null; updatedAt: string | null; transcript: string | null; externalLicense: string | null; externalSourceUrl: string | null };
type Coverage = { items: Array<{ type: 'dictation' | 'gist' | 'true_false' | 'mcq'; status: string | null; blockCount: number }>; readyCount: number; presentCount: number; blockCount: number; malformedCount: number; supplementalCount: number };
type ReadState<T> = { phase: 'loading' } | { phase: 'ready'; value: T } | { phase: 'error'; message: string };
type Banner = { kind: 'success' | 'error'; text: string } | null;

const POLL_DELAYS = [5000, 10000, 15000, 15000, 15000];
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusClass = (status: string | null) => status === 'published' ? 'is-live' : status === 'archived' ? 'is-failed' : status === 'mixed' ? 'is-mixed' : status ? 'is-new' : 'is-missing';

export function AdminListeningContentDetail({ contentId }: { contentId: string }) {
  const profile = useAdminProfile();
  const key = `${profile.id}:${contentId}`;
  const sequence = useRef(0);
  const contentReadOrder = useRef(0);
  const exerciseReadOrder = useRef(0);
  const pollTimer = useRef<number | null>(null);
  const [content, setContent] = useState<{ key: string; value: Content } | null>(null);
  const [exercises, setExercises] = useState<ReadState<Coverage>>({ phase: 'loading' });
  const [parentAudio, setParentAudio] = useState<ReadState<{ id: string; mode: string | null; ready: boolean }> | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [pollExhausted, setPollExhausted] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [confirmStatus, setConfirmStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const current = content?.key === key ? content.value : null;

  const readContent = useCallback(async (request: number, expectedStatus?: Status) => {
    const readOrder = ++contentReadOrder.current;
    const payload = await window.api.get<unknown>(`/admin/listening/content/${encodeURIComponent(contentId)}`);
    const row = (expectedStatus
      ? normalizeListeningStatusReadback(payload, contentId, expectedStatus)
      : normalizeListeningContentDetail(payload, contentId)) as Content | null;
    if (!row) throw new Error('Phản hồi nội dung không đúng contract canonical.');
    if (request !== sequence.current || readOrder !== contentReadOrder.current) return null;
    setContent({ key, value: row });
    if (row.testId) {
      setParentAudio({ phase: 'loading' });
      try {
        const parent = normalizeListeningTestAudio(await window.api.get<unknown>(`/admin/listening/tests/${encodeURIComponent(row.testId)}`), row.testId) as { id: string; mode: string | null; ready: boolean } | null;
        if (!parent) throw new Error('Payload test bundle không đúng contract.');
        if (request === sequence.current && readOrder === contentReadOrder.current) setParentAudio({ phase: 'ready', value: parent });
      } catch (caught) {
        if (request === sequence.current && readOrder === contentReadOrder.current) setParentAudio({ phase: 'error', message: messageOf(caught) });
      }
    } else setParentAudio(null);
    return row;
  }, [contentId, key]);

  const readExercises = useCallback(async (request: number) => {
    const readOrder = ++exerciseReadOrder.current;
    setExercises({ phase: 'loading' });
    try {
      const value = normalizeListeningExerciseCoverage(await window.api.get<unknown>(`/admin/listening/exercises?content_id=${encodeURIComponent(contentId)}`), contentId) as Coverage | null;
      if (!value) throw new Error('Payload exercise không đúng contract.');
      if (request === sequence.current && readOrder === exerciseReadOrder.current) setExercises({ phase: 'ready', value });
    } catch (caught) {
      if (request === sequence.current && readOrder === exerciseReadOrder.current) setExercises({ phase: 'error', message: messageOf(caught) });
    }
  }, [contentId]);

  const loadAll = useCallback(async () => {
    const request = ++sequence.current;
    setBanner(null); setContent(null); setExercises({ phase: 'loading' }); setParentAudio(null);
    void (async () => {
      try { await readContent(request); }
      catch (caught) { if (request === sequence.current) setBanner({ kind: 'error', text: `Không đọc được metadata: ${messageOf(caught)}` }); }
    })();
    void readExercises(request);
  }, [readContent, readExercises]);

  useEffect(() => { void loadAll(); return () => { sequence.current += 1; if (pollTimer.current) window.clearTimeout(pollTimer.current); }; }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    setPollExhausted(false);
    if (!current || current.sourceType !== 'ai_elevenlabs' || current.audioStoragePath || current.status === 'archived') return;
    let attempt = 0; let cancelled = false;
    const poll = () => {
      if (cancelled) return;
      if (attempt >= POLL_DELAYS.length) { setPollExhausted(true); return; }
      pollTimer.current = window.setTimeout(async () => {
        try {
          const request = sequence.current;
          const row = await readContent(request);
          if (!row?.audioStoragePath && row?.status !== 'archived') { attempt += 1; poll(); }
        } catch { attempt += 1; poll(); }
      }, POLL_DELAYS[attempt]);
    };
    poll();
    return () => { cancelled = true; if (pollTimer.current) window.clearTimeout(pollTimer.current); };
  }, [current?.id, current?.sourceType, current?.audioStoragePath, current?.status, pollEpoch, readContent]);

  const changeStatus = async () => {
    if (!confirmStatus || !current || busy) return;
    const target = confirmStatus; const request = sequence.current;
    if (pollTimer.current) { window.clearTimeout(pollTimer.current); pollTimer.current = null; }
    setBusy(true); setBanner(null);
    let contentReadRestarted = false;
    try {
      await window.api.patch(`/admin/listening/content/${encodeURIComponent(contentId)}/status`, { status: target });
      const readback = await readContent(request, target);
      if (!readback) throw new Error('Backend chưa xác nhận trạng thái vừa chọn.');
      contentReadRestarted = true;
      if (request !== sequence.current) return;
      setConfirmStatus(null);
      setBanner({ kind: 'success', text: `Đã đối chiếu backend: ${LISTENING_STATUS_LABEL[target]}.` });
    } catch (caught) {
      if (request === sequence.current) setBanner({ kind: 'error', text: `Không xác nhận được trạng thái canonical: ${messageOf(caught)}. Hãy đọc lại trước khi thao tác tiếp.` });
    } finally {
      if (request === sequence.current) {
        const refreshes: Promise<unknown>[] = [readExercises(request)];
        if (!contentReadRestarted) refreshes.push(readContent(request).catch((caught) => {
          if (request === sequence.current) setParentAudio({ phase: 'error', message: `Không tái đồng bộ được audio: ${messageOf(caught)}` });
        }));
        await Promise.allSettled(refreshes);
        if (request === sequence.current) {
          setPollEpoch((value) => value + 1);
          setBusy(false);
        }
      }
    }
  };

  if (!current && !banner) return <main className="ald-shell"><div className="ald-state" role="status">Đang đọc nội dung canonical…</div></main>;
  if (!current) return <main className="ald-shell"><div className="alc-banner is-error" role="alert"><strong>Không mở được nội dung.</strong><span>{banner?.text}</span></div><button className="adm-btn-secondary" type="button" onClick={() => void loadAll()}>Thử lại</button></main>;

  const parent = parentAudio?.phase === 'ready' ? parentAudio.value : parentAudio?.phase === 'error' ? null : undefined;
  const audio = listeningAudioState(current, parent);
  const audioCopy = audio === 'ready' ? `Audio riêng · ${formatListeningDuration(current.durationSeconds)}` : audio === 'test_ready' ? 'Audio nằm ở test bundle' : audio === 'checking' ? 'Đang kiểm tra audio parent' : audio === 'unknown' ? 'Không đọc được trạng thái audio parent' : audio === 'rendering' ? 'ElevenLabs đang render' : audio === 'failed' ? 'Render đã thất bại' : 'Chưa có nguồn audio dùng được';

  return <main className="ald-shell">
    <nav className="ald-breadcrumb" aria-label="Breadcrumb"><a href="/admin/listening">Listening content</a><span aria-hidden="true">/</span><span>{current.id}</span></nav>
    {banner && <div className={`alc-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}><strong>{banner.kind === 'error' ? 'Cần kiểm tra' : 'Đã lưu'}</strong><span>{banner.text}</span></div>}
    <header className="ald-hero"><div><p className="alc-eyebrow">Listening · Content detail</p><h1>{current.title}</h1><code>{current.id}</code></div><div className="ald-hero__side"><span className={`adm-status-pill ${statusClass(current.status)}`}>{LISTENING_STATUS_LABEL[current.status]}</span><small>Cập nhật {formatListeningContentDate(current.updatedAt || current.createdAt)}</small></div></header>
    <div className="ald-grid">
      <section className="ald-card ald-card--meta" aria-labelledby="ald-meta"><div className="ald-card__head"><div><p className="alc-eyebrow">Canonical metadata</p><h2 id="ald-meta">Thông tin nội dung</h2></div><a className="adm-btn-secondary" href={`/pages/admin/listening/content-meta.html?id=${encodeURIComponent(current.id)}`}>Sửa metadata ↗</a></div><dl className="ald-meta"><div><dt>Accent / CEFR</dt><dd>{[current.accent, current.cefr].filter(Boolean).join(' · ') || 'Chưa phân loại'}</dd></div><div><dt>IELTS section</dt><dd>{current.ieltsSection || current.sectionNum || '—'}</dd></div><div><dt>Topic tags</dt><dd>{current.topicTags.join(' · ') || '—'}</dd></div><div><dt>Premium</dt><dd>{current.isPremium ? 'Có' : 'Không'}</dd></div><div><dt>Nguồn</dt><dd>{current.sourceType || '—'}</dd></div><div><dt>License</dt><dd>{current.externalLicense || '—'}</dd></div><div><dt>Source URL</dt><dd>{current.externalSourceUrl || '—'}</dd></div></dl></section>
      <section className="ald-card ald-card--audio" aria-labelledby="ald-audio"><p className="alc-eyebrow">Audio truth</p><h2 id="ald-audio">Nguồn phát</h2><span className={`alc-audio is-${audio}`}>{audioCopy}</span>{current.testId && <code>test {current.testId}</code>}{current.audioSignedUrl && <audio controls preload="metadata" src={current.audioSignedUrl}>Trình duyệt không hỗ trợ audio.</audio>}{parentAudio?.phase === 'error' && <p className="ald-error">{parentAudio.message}</p>}{pollExhausted && <p className="ald-error">Đã dừng tự kiểm tra sau 60 giây. Trạng thái trên vẫn là dữ liệu backend gần nhất; dùng “Đọc lại tất cả” để kiểm tra tiếp.</p>}</section>
      <section className="ald-card ald-card--status" aria-labelledby="ald-status"><p className="alc-eyebrow">Publication</p><h2 id="ald-status">Trạng thái học viên nhìn thấy</h2><p>Published mở nội dung cho học viên; Draft và Archived ẩn khỏi thư viện. Lịch sử attempt không bị xóa.</p><div className="ald-status-actions">{(['published', 'draft', 'archived'] as Status[]).map((status) => <button key={status} type="button" className={status === 'archived' ? 'adm-btn-danger' : status === 'published' ? 'adm-btn-primary' : 'adm-btn-secondary'} disabled={busy || current.status === status} onClick={() => setConfirmStatus(status)}>{LISTENING_STATUS_LABEL[status]}</button>)}</div></section>
    </div>
    <section className="ald-card ald-exercises" aria-labelledby="ald-exercises"><div className="ald-card__head"><div><p className="alc-eyebrow">Exercise coverage</p><h2 id="ald-exercises">Bốn loại bài tập</h2></div><button className="adm-btn-secondary" type="button" onClick={() => void loadAll()} disabled={busy}>Đọc lại tất cả</button></div><ExerciseMatrix state={exercises} contentId={current.id} /></section>
    <section className="ald-card" aria-labelledby="ald-transcript"><p className="alc-eyebrow">Transcript</p><h2 id="ald-transcript">Bản đọc</h2><pre className="ald-transcript">{current.transcript || 'Chưa có transcript.'}</pre></section>
    <a className="alc-rollback" href={`/pages/admin/listening/content-detail.html?id=${encodeURIComponent(current.id)}`}>Mở bản HTML rollback ↗</a>
    <Dialog open={Boolean(confirmStatus)} title={`Chuyển sang ${confirmStatus ? LISTENING_STATUS_LABEL[confirmStatus] : ''}?`} description={confirmStatus === 'published' ? 'Học viên sẽ thấy nội dung sau khi backend xác nhận.' : 'Nội dung sẽ bị ẩn khỏi thư viện học viên; lịch sử attempt vẫn được giữ.'} busy={busy} onClose={() => setConfirmStatus(null)} actions={<><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setConfirmStatus(null)}>Hủy</button><button className={confirmStatus === 'archived' ? 'adm-btn-danger' : 'adm-btn-primary'} type="button" disabled={busy} onClick={() => void changeStatus()}>{busy ? 'Đang đối chiếu…' : 'Xác nhận trạng thái'}</button></>} />
  </main>;
}

function ExerciseMatrix({ state, contentId }: { state: ReadState<Coverage>; contentId: string }) {
  if (state.phase === 'loading') return <div className="ald-state" role="status">Đang đọc exercise độc lập…</div>;
  if (state.phase === 'error') return <div className="alc-banner is-error" role="alert"><strong>Không đọc được exercise.</strong><span>{state.message}. Metadata phía trên vẫn là dữ liệu thật; lỗi này không có nghĩa “chưa có bài”.</span></div>;
  return <div className="ald-exercise-grid">{state.value.items.map((item) => { const editor = item.type === 'dictation' ? 'segments' : item.type === 'true_false' ? 'tf' : item.type; return <article key={item.type}><div><strong>{LISTENING_EXERCISE_LABEL[item.type]}</strong><span className={`adm-status-pill ${statusClass(item.status)}`}>{item.status || 'Chưa có'}</span></div><p>{item.blockCount} block · {item.status === 'mixed' ? 'nhiều trạng thái' : item.status || 'chưa soạn'}</p><a className="adm-btn-secondary" href={`/pages/admin/listening/${editor}.html?content_id=${encodeURIComponent(contentId)}`}>{item.blockCount ? 'Mở editor' : 'Tạo bài'} ↗</a></article>; })}<p className="ald-exercise-summary">{state.value.presentCount}/4 loại · {state.value.blockCount} block · {state.value.readyCount}/4 published{state.value.supplementalCount ? ` · ${state.value.supplementalCount} mini-test` : ''}{state.value.malformedCount ? ` · ${state.value.malformedCount} dòng sai contract` : ''}</p></div>;
}
