'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import { formatListeningContentDate, formatListeningDuration } from '@/lib/admin-listening-content-model.mjs';
import {
  LISTENING_AUDIO_MODE_LABEL, LISTENING_TEST_STATUS_LABEL, LISTENING_TEST_TYPE_LABEL,
  canPublishListeningTest, formatListeningBytes, normalizeListeningAudioBundle,
  listeningTestDeleteReceiptKey, makeListeningTestDeleteReceipt,
  normalizeListeningHardDeleteAck, normalizeListeningMapSignedUrl,
  normalizeListeningTestDetail, normalizeListeningTestReadback,
  validateListeningAudioFile, validateListeningMapFile,
} from '@/lib/admin-listening-test-detail-model.mjs';

type Status = 'draft' | 'published' | 'archived';
type AudioMode = 'full_premixed' | 'parts_auto_assembled' | 'parts_only';
type Section = { id: string; number: number; title: string; status: Status; audioStoragePath: string | null; audioReady: boolean; exerciseCount: number };
type PlanExercise = { id: string; contentId: string; sectionNumber: number; hasMapImage: boolean; mapDescription: string; letterOptions: string[]; mapImageModel: string | null; mapImageSource: string | null; mapImageGeneratedAt: string | null };
type TestDetail = { id: string; testId: string; title: string; status: Status; type: 'full' | 'mini' | 'drill' | 'practice'; version: string; bandTarget: number | null; accentProfile: string[]; totalTranscriptWords: number | null; examOnly: boolean; createdAt: string | null; updatedAt: string | null; audioMode: AudioMode | null; fullAudioStoragePath: string | null; fullAudioDurationSeconds: number | null; fullAudioSizeBytes: number | null; assembledAudioStoragePath: string | null; assembledAudioGeneratedAt: string | null; sections: Section[]; planExercises: PlanExercise[]; cues: Array<{ type: string; sectionNumber: number | null; timestampSeconds: number }>; malformedSectionCount: number; malformedPlanCount: number; malformedCueCount: number };
type AudioAsset = { storagePath: string | null; signedUrl: string | null; durationSeconds: number | null; sizeBytes: number | null; generatedAt: string | null };
type AudioBundle = { full: AudioAsset; assembled: AudioAsset; sections: Array<AudioAsset & { number: number }>; unavailableCount: number };
type ReadState<T> = { phase: 'loading' } | { phase: 'ready'; value: T } | { phase: 'error'; message: string };
type Banner = { kind: 'success' | 'error' | 'warning'; text: string } | null;
type Action = { kind: 'status'; status: Status } | { kind: 'archive' } | { kind: 'hard-delete' } | { kind: 'delete-map'; exercise: PlanExercise };
type MapPreview = { phase: 'loading' } | { phase: 'ready'; url: string } | { phase: 'error'; message: string };
type MapSelection = { file: File; url: string };
type DeleteAck = { content: number; exercises: number; attempts: number; storageFilesRemoved: number; storageFilesFailed: string[] };

const AUDIO_MODES: AudioMode[] = ['full_premixed', 'parts_auto_assembled', 'parts_only'];
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusClass = (status: Status) => status === 'published' ? 'is-live' : status === 'archived' ? 'is-failed' : 'is-new';

export function AdminListeningTestDetail({ testId }: { testId: string }) {
  const profile = useAdminProfile();
  const router = useRouter();
  const key = `${profile.id}:${testId}`;
  const sequence = useRef(0);
  const detailOrder = useRef(0);
  const audioOrder = useRef(0);
  const mapOrder = useRef(0);
  const mapSelectionsRef = useRef<Record<string, MapSelection>>({});
  const [detail, setDetail] = useState<{ key: string; value: TestDetail } | null>(null);
  const [audio, setAudio] = useState<ReadState<AudioBundle>>({ phase: 'loading' });
  const [mapPreviews, setMapPreviews] = useState<Record<string, MapPreview>>({});
  const [mapSelections, setMapSelections] = useState<Record<string, MapSelection>>({});
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [hardDeleteText, setHardDeleteText] = useState('');
  const [modeDraft, setModeDraft] = useState<AudioMode | null>(null);
  const current = detail?.key === key ? detail.value : null;

  useEffect(() => { mapSelectionsRef.current = mapSelections; }, [mapSelections]);

  const readDetail = useCallback(async (request: number, expected?: Record<string, unknown>) => {
    const order = ++detailOrder.current;
    const raw = await window.api.get<unknown>(`/admin/listening/tests/${encodeURIComponent(testId)}`);
    const row = (expected
      ? normalizeListeningTestReadback(raw, testId, expected)
      : normalizeListeningTestDetail(raw, testId)) as TestDetail | null;
    if (!row) throw new Error('Phản hồi test detail không đúng contract canonical.');
    if (request !== sequence.current || order !== detailOrder.current) return null;
    setDetail({ key, value: row });
    return row;
  }, [key, testId]);

  const readAudio = useCallback(async (request: number) => {
    const order = ++audioOrder.current;
    setAudio({ phase: 'loading' });
    try {
      const value = normalizeListeningAudioBundle(await window.api.get<unknown>(`/admin/listening/tests/${encodeURIComponent(testId)}/audio/signed-urls`)) as AudioBundle | null;
      if (!value) throw new Error('Payload signed audio không đúng contract.');
      if (request === sequence.current && order === audioOrder.current) setAudio({ phase: 'ready', value });
      return value;
    } catch (caught) {
      if (request === sequence.current && order === audioOrder.current) setAudio({ phase: 'error', message: messageOf(caught) });
      return null;
    }
  }, [testId]);

  const loadAll = useCallback(async () => {
    const request = ++sequence.current;
    setDetail(null); setAudio({ phase: 'loading' }); setMapPreviews({}); setBanner(null); setAction(null); setBusy(null); setModeDraft(null);
    const results = await Promise.allSettled([readDetail(request), readAudio(request)]);
    if (request !== sequence.current) return;
    if (results[0].status === 'rejected') setBanner({ kind: 'error', text: `Không đọc được test canonical: ${messageOf(results[0].reason)}` });
  }, [readAudio, readDetail]);

  useEffect(() => {
    void loadAll();
    return () => {
      sequence.current += 1;
      Object.values(mapSelectionsRef.current).forEach((selection) => URL.revokeObjectURL(selection.url));
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!current) return;
    const request = sequence.current;
    const order = ++mapOrder.current;
    const withImages = current.planExercises.filter((exercise) => exercise.hasMapImage);
    setMapPreviews(Object.fromEntries(withImages.map((exercise) => [exercise.id, { phase: 'loading' }])));
    withImages.forEach((exercise) => {
      void (async () => {
        try {
          const value = normalizeListeningMapSignedUrl(
            await window.api.get<unknown>(`/admin/listening/exercises/${encodeURIComponent(exercise.id)}/map-image/signed-url`),
            exercise.id,
          ) as { signedUrl: string } | null;
          if (!value) throw new Error('Payload preview map không đúng contract.');
          if (request === sequence.current && order === mapOrder.current) setMapPreviews((state) => ({ ...state, [exercise.id]: { phase: 'ready', url: value.signedUrl } }));
        } catch (caught) {
          if (request === sequence.current && order === mapOrder.current) setMapPreviews((state) => ({ ...state, [exercise.id]: { phase: 'error', message: messageOf(caught) } }));
        }
      })();
    });
  }, [current?.id, current?.planExercises.map((exercise) => `${exercise.id}:${exercise.hasMapImage}:${exercise.mapImageGeneratedAt || ''}`).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const reconcile = useCallback(async (request: number, expected: Record<string, unknown>, success: string) => {
    const row = await readDetail(request, expected);
    if (!row) throw new Error('Readback đã bị thay bởi một lần đọc mới hơn.');
    await readAudio(request);
    if (request === sequence.current) setBanner({ kind: 'success', text: success });
    return row;
  }, [readAudio, readDetail]);

  const changeMode = async (mode: AudioMode) => {
    if (!current || busy) return;
    const request = sequence.current;
    setModeDraft(mode); setBusy('mode'); setBanner(null);
    try {
      await window.api.patch(`/admin/listening/tests/${encodeURIComponent(testId)}/audio/mode`, { mode });
      await reconcile(request, { mode }, `Đã đối chiếu backend: ${LISTENING_AUDIO_MODE_LABEL[mode]}.`);
    } catch (caught) {
      try { await readDetail(request); } catch { /* banner below remains authoritative */ }
      if (request === sequence.current) setBanner({ kind: 'error', text: `Không xác nhận được audio mode canonical: ${messageOf(caught)}` });
    } finally { if (request === sequence.current) { setModeDraft(null); setBusy(null); } }
  };

  const uploadAudio = async (file: File, sectionNumber?: number) => {
    const validation = validateListeningAudioFile(file);
    if (validation) { setBanner({ kind: 'error', text: validation }); return; }
    if (!current || busy) return;
    const request = sequence.current;
    const operation = sectionNumber == null ? 'full-audio' : `section-${sectionNumber}`;
    setBusy(operation); setBanner(null);
    try {
      const body = new FormData(); body.append('audio', file);
      const path = sectionNumber == null
        ? `/admin/listening/tests/${encodeURIComponent(testId)}/audio/full`
        : `/admin/listening/tests/${encodeURIComponent(testId)}/audio/section/${sectionNumber}`;
      await window.api.upload(path, body);
      await reconcile(request, sectionNumber == null ? { fullAudio: true } : { sectionAudio: sectionNumber }, sectionNumber == null ? 'Full audio đã lưu và được backend xác nhận.' : `Audio section ${sectionNumber} đã lưu và được backend xác nhận.`);
    } catch (caught) {
      if (request === sequence.current) setBanner({ kind: 'error', text: `Upload audio không được xác nhận: ${messageOf(caught)}` });
    } finally { if (request === sequence.current) setBusy(null); }
  };

  const assemble = async () => {
    if (!current || busy) return;
    const request = sequence.current;
    setBusy('assemble'); setBanner(null);
    try {
      await window.api.post(`/admin/listening/tests/${encodeURIComponent(testId)}/audio/assemble`, {});
      await reconcile(request, { assembledAudio: true, mode: 'parts_auto_assembled' }, 'Assembled audio đã được backend xác nhận.');
    } catch (caught) {
      if (request === sequence.current) setBanner({ kind: 'error', text: `Assemble không được xác nhận: ${messageOf(caught)}` });
    } finally { if (request === sequence.current) setBusy(null); }
  };

  const confirmAction = async () => {
    if (!current || !action || busy) return;
    const request = sequence.current;
    const target = action;
    setBusy(target.kind); setBanner(null);
    try {
      if (target.kind === 'status') {
        await window.api.patch(`/admin/listening/tests/${encodeURIComponent(testId)}/status`, { status: target.status });
        await reconcile(request, { status: target.status }, `Đã đối chiếu backend: ${LISTENING_TEST_STATUS_LABEL[target.status]}.`);
      } else if (target.kind === 'archive') {
        await window.api.delete(`/admin/listening/tests/${encodeURIComponent(testId)}`);
        await reconcile(request, { status: 'archived', allSectionsArchived: true }, 'Test và toàn bộ section đã được lưu trữ.');
      } else if (target.kind === 'delete-map') {
        await window.api.delete(`/admin/listening/exercises/${encodeURIComponent(target.exercise.id)}/map-image`);
        await reconcile(request, { mapExerciseId: target.exercise.id, hasMapImage: false }, `Đã xóa map của section ${target.exercise.sectionNumber}.`);
      } else {
        const ack = normalizeListeningHardDeleteAck(
          await window.api.delete<unknown>(`/admin/listening/tests/${encodeURIComponent(testId)}/hard`),
          current.id,
          current.testId,
        ) as DeleteAck | null;
        if (!ack) throw new Error('ACK hard delete không khớp identity hoặc cascade summary.');
        const receipt = makeListeningTestDeleteReceipt(current.testId, ack);
        if (!receipt) throw new Error('Không tạo được biên nhận hard delete.');
        try {
          window.sessionStorage.setItem(listeningTestDeleteReceiptKey(profile.id), JSON.stringify(receipt));
        } catch (caught) {
          if (ack.storageFilesFailed.length) {
            setBanner({ kind: 'warning', text: `${receipt.text} Không lưu được biên nhận điều hướng: ${messageOf(caught)}` });
            setAction(null);
            return;
          }
        }
        router.push('/admin/listening/tests');
        return;
      }
      if (request === sequence.current) setAction(null);
    } catch (caught) {
      if (request === sequence.current) setBanner({ kind: 'error', text: `Thao tác không được backend xác nhận: ${messageOf(caught)}` });
    } finally { if (request === sequence.current) setBusy(null); }
  };

  const chooseMapFile = (exerciseId: string, file: File) => {
    const validation = validateListeningMapFile(file);
    if (validation) { setBanner({ kind: 'error', text: validation }); return; }
    setMapSelections((state) => {
      if (state[exerciseId]) URL.revokeObjectURL(state[exerciseId].url);
      return { ...state, [exerciseId]: { file, url: URL.createObjectURL(file) } };
    });
  };

  const clearMapFile = (exerciseId: string) => setMapSelections((state) => {
    if (state[exerciseId]) URL.revokeObjectURL(state[exerciseId].url);
    const next = { ...state }; delete next[exerciseId]; return next;
  });

  const uploadMap = async (exercise: PlanExercise) => {
    const selection = mapSelections[exercise.id];
    if (!selection || !current || busy) return;
    const request = sequence.current;
    setBusy(`map-${exercise.id}`); setBanner(null);
    try {
      const body = new FormData(); body.append('image_file', selection.file);
      await window.api.upload(`/admin/listening/exercises/${encodeURIComponent(exercise.id)}/upload-map-image`, body);
      await reconcile(request, { mapExerciseId: exercise.id, hasMapImage: true }, `Map section ${exercise.sectionNumber} đã lưu với chi phí API $0.`);
      clearMapFile(exercise.id);
    } catch (caught) {
      if (request === sequence.current) setBanner({ kind: 'error', text: `Upload map không được xác nhận: ${messageOf(caught)}` });
    } finally { if (request === sequence.current) setBusy(null); }
  };

  if (!current && !banner) return <main className="altd-shell"><div className="altd-state" role="status">Đang đọc test canonical…</div></main>;
  if (!current) return <main className="altd-shell"><div className="alc-banner is-error" role="alert"><strong>Không mở được test.</strong><span>{banner?.text}</span></div><button className="adm-btn-secondary" type="button" onClick={() => void loadAll()}>Thử lại</button></main>;

  const publishGate = canPublishListeningTest(current);
  const selectedMode = modeDraft || current.audioMode || '';
  const audioValue = audio.phase === 'ready' ? audio.value : null;
  const requiredPartsReady = [1, 2, 3, 4].every((number) => current.sections.some((section) => section.number === number && section.audioReady));
  const malformed = current.malformedSectionCount + current.malformedPlanCount + current.malformedCueCount;

  return <main className="altd-shell">
    <nav className="altd-breadcrumb" aria-label="Breadcrumb"><a href="/admin/listening/tests">Listening tests</a><span aria-hidden="true">/</span><span>{current.testId}</span></nav>
    {banner && <div className={`alc-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}><strong>{banner.kind === 'success' ? 'Đã đối chiếu' : 'Cần kiểm tra'}</strong><span>{banner.text}</span></div>}
    {!!malformed && <div className="alc-banner is-warning" role="status"><strong>Payload chưa sạch</strong><span>Đã loại {malformed} section, cue hoặc map record sai contract; không diễn giải chúng thành dữ liệu trống.</span></div>}

    <header className="altd-hero"><div><p className="alc-eyebrow">Listening · Test workspace</p><h1>{current.testId}</h1><p>{current.title}</p></div><div className="altd-hero__side"><span className={`adm-status-pill ${statusClass(current.status)}`}>{LISTENING_TEST_STATUS_LABEL[current.status]}</span><span className={`altd-scope ${current.examOnly ? 'is-exam' : 'is-library'}`}>{current.examOnly ? 'Chỉ dùng cho kỳ thi' : 'Thư viện luyện tập'}</span><small>Cập nhật {formatListeningContentDate(current.updatedAt || current.createdAt)}</small></div></header>

    <section className="altd-meta" aria-labelledby="altd-meta-title"><div className="altd-section-head"><div><p className="alc-eyebrow">Canonical metadata</p><h2 id="altd-meta-title">Cấu trúc test</h2></div><button className="adm-btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => void loadAll()}>Đọc lại tất cả</button></div><dl><div><dt>Loại</dt><dd>{LISTENING_TEST_TYPE_LABEL[current.type]}</dd></div><div><dt>Version</dt><dd>{current.version}</dd></div><div><dt>Band</dt><dd>{current.bandTarget ?? '—'}</dd></div><div><dt>Accent</dt><dd>{current.accentProfile.join(' · ') || '—'}</dd></div><div><dt>Transcript</dt><dd>{current.totalTranscriptWords == null ? '—' : `${current.totalTranscriptWords} từ`}</dd></div><div><dt>Sections</dt><dd>{current.sections.length}</dd></div></dl></section>

    <section className="altd-card altd-audio" aria-labelledby="altd-audio-title"><div className="altd-section-head"><div><p className="alc-eyebrow">Audio pipeline</p><h2 id="altd-audio-title">Nguồn phát và assemble</h2></div><span className={`altd-read-state is-${audio.phase}`}>{audio.phase === 'loading' ? 'Đang ký URL…' : audio.phase === 'error' ? 'Preview lỗi' : 'Preview sẵn sàng'}</span></div>{audio.phase === 'error' && <p className="altd-inline-error" role="alert">Không lấy được signed URL: {audio.message}. Storage path bên dưới vẫn là canonical truth; lỗi này không có nghĩa audio chưa tồn tại.</p>}
      {audioValue?.unavailableCount ? <p className="altd-inline-error" role="alert">Có {audioValue.unavailableCount} storage record nhưng backend không ký được preview URL. Không diễn giải chúng thành “chưa có audio”.</p> : null}
      <label className="altd-mode"><span>Chế độ audio</span><select value={selectedMode} disabled={Boolean(busy)} onChange={(event) => void changeMode(event.target.value as AudioMode)}><option value="" disabled>Chọn chế độ</option>{AUDIO_MODES.map((mode) => <option key={mode} value={mode}>{LISTENING_AUDIO_MODE_LABEL[mode]}</option>)}</select></label>
      {selectedMode === 'full_premixed' && <div className="altd-audio-panel"><AudioAssetCard title="Full pre-mixed" asset={audioValue?.full || null} canonicalPath={current.fullAudioStoragePath} description={`${formatListeningDuration(current.fullAudioDurationSeconds)} · ${formatListeningBytes(current.fullAudioSizeBytes)}`}><FileDrop label={current.fullAudioStoragePath ? 'Thay full audio' : 'Tải full audio'} accept=".mp3,audio/mpeg" disabled={Boolean(busy)} onFile={(file) => void uploadAudio(file)} /></AudioAssetCard></div>}
      {(selectedMode === 'parts_auto_assembled' || selectedMode === 'parts_only') && <><div className="altd-parts">{current.sections.map((section) => { const signed = audioValue?.sections.find((item) => item.number === section.number); return <AudioAssetCard key={section.id} title={`Section ${section.number}`} asset={signed || null} canonicalPath={section.audioStoragePath} description={`${section.title} · ${section.exerciseCount} exercise`}><FileDrop label={section.audioReady ? 'Thay audio part' : 'Tải audio part'} accept=".mp3,audio/mpeg" disabled={Boolean(busy)} onFile={(file) => void uploadAudio(file, section.number)} /></AudioAssetCard>; })}</div>{selectedMode === 'parts_auto_assembled' && <div className="altd-assemble"><div><strong>Assembled output</strong><p>{requiredPartsReady ? 'Đủ 4 part để render narrator và ghép audio.' : 'Backend yêu cầu đủ section 1–4 có audio.'}</p>{audioValue?.assembled.signedUrl && <audio controls preload="metadata" src={audioValue.assembled.signedUrl}>Trình duyệt không hỗ trợ audio.</audio>}</div><button className="adm-btn-primary" type="button" disabled={Boolean(busy) || !requiredPartsReady} onClick={() => void assemble()}>{busy === 'assemble' ? 'Đang assemble…' : 'Render & assemble'}</button></div>}</>}
      <div className={`altd-publish-gate ${publishGate.ok ? 'is-ready' : 'is-blocked'}`}><div><strong>{publishGate.ok ? 'Có thể phát hành' : 'Chưa qua cổng publish'}</strong><p>{publishGate.reason}</p></div><button className="adm-btn-primary" type="button" disabled={Boolean(busy) || !publishGate.ok || current.status === 'published'} onClick={() => setAction({ kind: 'status', status: 'published' })}>{current.status === 'published' ? 'Đang phát hành' : 'Phát hành test'}</button></div>
    </section>

    <section className="altd-card" aria-labelledby="altd-sections-title"><div className="altd-section-head"><div><p className="alc-eyebrow">Content ownership</p><h2 id="altd-sections-title">Sections và exercises</h2></div><span>{current.sections.filter((section) => section.audioReady).length}/{current.sections.length} section có audio</span></div>{current.sections.length ? <div className="altd-section-grid">{current.sections.map((section) => <article key={section.id}><div><span>S{section.number}</span><span className={`adm-status-pill ${statusClass(section.status)}`}>{LISTENING_TEST_STATUS_LABEL[section.status]}</span></div><h3>{section.title}</h3><p>{section.audioReady ? '✓ Có audio' : 'Chưa có audio'} · {section.exerciseCount} exercises</p><a className="adm-btn-secondary" href={`/admin/listening/content/${encodeURIComponent(section.id)}`}>Mở content detail ↗</a></article>)}</div> : <div className="altd-empty"><strong>Chưa có section canonical</strong><span>Import lại bundle trước khi upload audio hoặc publish.</span></div>}</section>

    {!!current.cues.length && <section className="altd-card" aria-labelledby="altd-cues-title"><div className="altd-section-head"><div><p className="alc-eyebrow">Assembled timeline</p><h2 id="altd-cues-title">Cue points</h2></div><span>{current.cues.length} mốc</span></div><div className="altd-table-wrap" role="region" aria-label="Cue points" tabIndex={0}><table><thead><tr><th>Type</th><th>Section</th><th>Time</th></tr></thead><tbody>{current.cues.map((cue, index) => <tr key={`${cue.type}-${cue.timestampSeconds}-${index}`}><td>{cue.type}</td><td>{cue.sectionNumber ?? '—'}</td><td>{cue.timestampSeconds.toFixed(2)}s</td></tr>)}</tbody></table></div></section>}

    {!!current.planExercises.length && <section className="altd-card" aria-labelledby="altd-maps-title"><div className="altd-section-head"><div><p className="alc-eyebrow">Plan-label assets</p><h2 id="altd-maps-title">Hình map</h2></div><span>Manual upload · $0 API</span></div><div className="altd-map-grid">{current.planExercises.map((exercise) => { const preview = mapPreviews[exercise.id]; const selection = mapSelections[exercise.id]; return <article key={exercise.id} className="altd-map-card"><div className="altd-map-card__head"><div><strong>Section {exercise.sectionNumber}</strong><small>{exercise.letterOptions.join(' · ') || 'Plan label'}</small></div><span className={`altd-source is-${exercise.mapImageSource || 'missing'}`}>{exercise.hasMapImage ? exercise.mapImageSource === 'manual_upload' ? 'Manual upload' : `API${exercise.mapImageModel ? ` · ${exercise.mapImageModel}` : ''}` : 'Chưa có hình'}</span></div>{exercise.hasMapImage && preview?.phase === 'loading' && <div className="altd-map-state" role="status">Đang ký URL preview…</div>}{exercise.hasMapImage && preview?.phase === 'error' && <div className="altd-inline-error" role="alert">Có storage record nhưng không mở được preview: {preview.message}</div>}{preview?.phase === 'ready' && <img className="altd-map-image" src={preview.url} alt={`Floor plan section ${exercise.sectionNumber}`} />}{selection && <div className="altd-map-selection"><img src={selection.url} alt={`Ảnh chờ upload cho section ${exercise.sectionNumber}`} /><span>{selection.file.name} · {formatListeningBytes(selection.file.size)}</span></div>}<FileDrop label={exercise.hasMapImage ? 'Chọn ảnh thay thế' : 'Chọn ảnh map'} accept="image/png,image/jpeg,image/webp" disabled={Boolean(busy)} onFile={(file) => chooseMapFile(exercise.id, file)} />{selection && <div className="altd-map-actions"><button className="adm-btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => clearMapFile(exercise.id)}>Hủy file</button><button className="adm-btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void uploadMap(exercise)}>{busy === `map-${exercise.id}` ? 'Đang upload…' : 'Xác nhận upload · $0'}</button></div>}{exercise.hasMapImage && <button className="adm-btn-danger" type="button" disabled={Boolean(busy)} onClick={() => setAction({ kind: 'delete-map', exercise })}>Xóa hình hiện tại</button>}</article>; })}</div></section>}

    <section className="altd-card altd-publication" aria-labelledby="altd-publication-title"><div><p className="alc-eyebrow">Publication lifecycle</p><h2 id="altd-publication-title">Trạng thái parent test</h2><p>Thay đổi ở đây chỉ áp dụng parent test. “Lưu trữ toàn bundle” trong vùng nguy hiểm mới archive cả các section.</p></div><div>{(['draft', 'published', 'archived'] as Status[]).map((status) => <button key={status} className={status === 'archived' ? 'adm-btn-danger' : status === 'published' ? 'adm-btn-primary' : 'adm-btn-secondary'} type="button" disabled={Boolean(busy) || current.status === status || (status === 'published' && !publishGate.ok)} onClick={() => setAction({ kind: 'status', status })}>{LISTENING_TEST_STATUS_LABEL[status]}</button>)}</div></section>

    <section className="altd-card altd-danger" aria-labelledby="altd-danger-title"><div><p className="alc-eyebrow">Danger zone</p><h2 id="altd-danger-title">Xóa và lưu trữ</h2><p>Hai hành động này khác nhau: archive giữ lịch sử; hard delete xóa cả attempts và không thể hoàn tác.</p></div><div className="altd-danger__actions"><article><strong>Lưu trữ toàn bundle</strong><p>Archive parent và mọi section; giữ audio, exercises và attempt history.</p><button className="adm-btn-danger" type="button" disabled={Boolean(busy)} onClick={() => setAction({ kind: 'archive' })}>Lưu trữ toàn bundle</button></article><article><strong>Xóa vĩnh viễn</strong><p>Xóa test, sections, exercises, attempts và dọn storage best-effort.</p><button className="adm-btn-danger" type="button" disabled={Boolean(busy)} onClick={() => { setHardDeleteText(''); setAction({ kind: 'hard-delete' }); }}>Xóa vĩnh viễn</button></article></div></section>

    <a className="alc-rollback" href={`/pages/admin/listening/tests-detail.html?id=${encodeURIComponent(current.id)}`}>Mở bản HTML rollback ↗</a>

    <Dialog open={Boolean(action)} title={actionTitle(action, current.testId)} description={actionDescription(action)} busy={Boolean(busy)} onClose={() => { setAction(null); setHardDeleteText(''); }} actions={<><button className="adm-btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => { setAction(null); setHardDeleteText(''); }}>Hủy</button><button className={action?.kind === 'status' && action.status !== 'archived' ? 'adm-btn-primary' : 'adm-btn-danger'} type="button" disabled={Boolean(busy) || (action?.kind === 'hard-delete' && hardDeleteText !== current.testId)} onClick={() => void confirmAction()}>{busy ? 'Đang đối chiếu…' : action?.kind === 'hard-delete' ? 'Xóa vĩnh viễn' : 'Xác nhận thay đổi'}</button></>}>
      {action?.kind === 'hard-delete' && <label className="altd-confirm-field"><span>Nhập chính xác <code>{current.testId}</code></span><input autoComplete="off" value={hardDeleteText} onChange={(event) => setHardDeleteText(event.target.value)} /></label>}
    </Dialog>
  </main>;
}

function FileDrop({ label, accept, disabled, onFile }: { label: string; accept: string; disabled: boolean; onFile: (file: File) => void }) {
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!disabled) { const file = event.dataTransfer.files?.[0]; if (file) onFile(file); }
  };
  return <label className={`altd-drop${disabled ? ' is-disabled' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}><span>{label}</span><small>Kéo thả hoặc chọn file</small><input type="file" accept={accept} disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ''; }} /></label>;
}

function AudioAssetCard({ title, asset, canonicalPath, description, children }: { title: string; asset: AudioAsset | null; canonicalPath: string | null; description: string; children: ReactNode }) {
  return <article className="altd-audio-asset"><div><strong>{title}</strong><p>{canonicalPath || 'Chưa có storage path'}</p><small>{description}</small></div>{asset?.signedUrl && <audio controls preload="metadata" src={asset.signedUrl}>Trình duyệt không hỗ trợ audio.</audio>}{children}</article>;
}

function actionTitle(action: Action | null, testId: string) {
  if (!action) return '';
  if (action.kind === 'status') return `Chuyển ${testId} sang ${LISTENING_TEST_STATUS_LABEL[action.status]}?`;
  if (action.kind === 'archive') return `Lưu trữ toàn bundle ${testId}?`;
  if (action.kind === 'delete-map') return `Xóa map section ${action.exercise.sectionNumber}?`;
  return `Xóa vĩnh viễn ${testId}?`;
}

function actionDescription(action: Action | null) {
  if (!action) return '';
  if (action.kind === 'status') return action.status === 'published' ? 'Backend sẽ kiểm cổng audio; UI chỉ xác nhận sau canonical GET.' : 'Chỉ trạng thái parent test thay đổi; section vẫn giữ nguyên.';
  if (action.kind === 'archive') return 'Parent và mọi section sẽ chuyển archived; attempt history được giữ nguyên.';
  if (action.kind === 'delete-map') return 'Storage object và metadata map của exercise sẽ bị xóa.';
  return 'Không thể hoàn tác. Test, sections, exercises và attempt history sẽ bị xóa vĩnh viễn.';
}
