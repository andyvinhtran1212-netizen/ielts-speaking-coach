'use client';

// SPIKE 1 (plan Phase 2 critical-risk spike #1) — MediaRecorder under React.
//
// A faithful React port of the legacy practice.js recording pipeline
// (frontend/js/practice.js:290-433): same getUserMedia constraints, same
// stream-reuse rule, same MIME candidate ladder, same MediaRecorder
// start(250) chunking, same AudioContext+analyser attach (the Safari
// suspended-state risk surface), same 90s hard stop — PLUS the React-specific
// risk this spike exists to measure: mount/unmount lifecycle (StrictMode
// double-invoke, cleanup releasing the mic, no zombie recorder).
//
// NOT product code. Dark route, no chrome, diagnostics-first UI so the same
// page doubles as the MANUAL test protocol page for real Safari/iOS devices.
import { useCallback, useEffect, useRef, useState } from 'react';

type RecState = 'idle' | 'recording' | 'recorded';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4', // Safari's lane
];
const MAX_RECORD_SEC = 90;

declare global {
  interface Window {
    __spikeDiag?: Record<string, unknown>;
    __spikeUpload?: { apiBase: string; token: string; sessionId: string; questionId: string };
  }
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const c of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch { /* isTypeSupported can throw on odd inputs in old engines */ }
  }
  return '';
}

export function RecorderSpike() {
  const [recState, setRecState] = useState<RecState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [diag, setDiag] = useState<Record<string, unknown>>({});
  const [uploadResult, setUploadResult] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const publishDiag = useCallback((patch: Record<string, unknown>) => {
    setDiag((prev) => {
      const next = { ...prev, ...patch };
      // Window mirror: lets Playwright/manual testers read state after the
      // component unmounted (the whole point of the lifecycle tests).
      try {
        // MERGE into the window mirror — fields written outside React state
        // (mountCount, unmounted markers) must survive every publish.
        window.__spikeDiag = {
          ...(window.__spikeDiag || {}),
          ...next,
          trackStates: (streamRef.current?.getTracks() || []).map((t) => t.readyState),
          recorderState: recorderRef.current?.state || 'none',
          audioCtxState: audioCtxRef.current?.state || 'none',
        };
      } catch { /* diagnostics never break the page */ }
      return next;
    });
  }, []);

  // ── Lifecycle cleanup — the React-specific risk under test ─────────
  useEffect(() => {
    publishDiag({ mounted: true, strictModeProbe: (window.__spikeDiag?.mountCount as number || 0) + 1 });
    try {
      window.__spikeDiag = { ...(window.__spikeDiag || {}), mountCount: ((window.__spikeDiag?.mountCount as number) || 0) + 1 };
    } catch { /* ignore */ }
    return () => {
      // Mirror legacy _resetRecorder + full teardown: a component that
      // unmounts MID-RECORDING must not leave the mic live (tab indicator)
      // or a zombie recorder pushing chunks into freed state.
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null; // stale onstop must not fire into unmounted state
        try { rec.stop(); } catch { /* already stopping */ }
      }
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* */ } });
      streamRef.current = null;
      try { void audioCtxRef.current?.close(); } catch { /* */ }
      audioCtxRef.current = null;
      if (blobUrlRef.current) { try { URL.revokeObjectURL(blobUrlRef.current); } catch { /* */ } blobUrlRef.current = null; }
      try {
        window.__spikeDiag = { ...(window.__spikeDiag || {}), unmounted: true, trackStatesAfterUnmount: 'stopped-by-cleanup' };
      } catch { /* */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setUploadResult(null);
    if (recorderRef.current?.state === 'recording') return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Trình duyệt không hỗ trợ ghi âm (getUserMedia).');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('Trình duyệt không hỗ trợ MediaRecorder.');
      return;
    }

    // Legacy rule: reuse the stream while it is still active.
    if (!streamRef.current || !streamRef.current.active) {
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err: any) {
        const name = err?.name;
        setError(
          name === 'NotAllowedError' || name === 'PermissionDeniedError'
            ? 'Bạn đã từ chối quyền microphone.'
            : name === 'NotFoundError' ? 'Không tìm thấy microphone.'
            : name === 'NotReadableError' ? 'Microphone đang được dùng bởi ứng dụng khác.'
            : 'Không thể mở microphone: ' + (err?.message || err),
        );
        publishDiag({ gumError: String(name || err) });
        return;
      }
    }

    // AudioContext analyser — optional exactly like legacy (Safari: created
    // in a user gesture, may start suspended → resume()).
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AC();
      }
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
      const src = audioCtxRef.current.createMediaStreamSource(streamRef.current);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
    } catch { /* non-fatal, same as legacy */ }

    const mime = pickMime();
    chunksRef.current = [];
    blobRef.current = null;

    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : {});
    } catch {
      rec = new MediaRecorder(streamRef.current);
    }
    recorderRef.current = rec;

    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType && rec.mimeType !== '' ? rec.mimeType : 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      blobRef.current = blob;
      if (blobUrlRef.current) { try { URL.revokeObjectURL(blobUrlRef.current); } catch { /* */ } }
      blobUrlRef.current = URL.createObjectURL(blob);
      publishDiag({ blobSize: blob.size, blobType: type, chunks: chunksRef.current.length, blobUrl: blobUrlRef.current });
      setRecState('recorded');
    };

    rec.start(250); // legacy 250ms chunking
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed((s) => {
        if (s + 1 >= MAX_RECORD_SEC) stop();
        return s + 1;
      });
    }, 1000);

    publishDiag({ mimeChosen: mime || '(engine default)', started: true });
    setRecState('recording');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishDiag]);

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop(); // onstop → recorded
  }, []);

  const reset = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      try { rec.stop(); } catch { /* */ }
    }
    blobRef.current = null;
    chunksRef.current = [];
    setRecState('idle');
    publishDiag({ resetAt: elapsed });
  }, [elapsed, publishDiag]);

  // Upload the recorded blob through the LEGACY multipart contract
  // (POST /sessions/{id}/responses, fields question_id + audio_file) —
  // config injected via window.__spikeUpload (test or console).
  const upload = useCallback(async () => {
    const cfg = window.__spikeUpload;
    if (!cfg) { setUploadResult('Thiếu window.__spikeUpload'); return; }
    if (!blobRef.current) { setUploadResult('Chưa có bản ghi'); return; }
    setUploadResult('uploading…');
    try {
      const fd = new FormData();
      fd.append('question_id', cfg.questionId);
      fd.append('audio_file', blobRef.current, 'response.webm');
      const res = await fetch(`${cfg.apiBase}/sessions/${cfg.sessionId}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      const summary = `HTTP ${res.status}` + (body?.band_scores ? ` band=${JSON.stringify(body.band_scores)}` : ` ${JSON.stringify(body).slice(0, 120)}`);
      setUploadResult(summary);
      publishDiag({ upload: summary, uploadStatus: res.status });
    } catch (err: any) {
      setUploadResult('FAILED: ' + (err?.message || err));
      publishDiag({ upload: 'FAILED: ' + (err?.message || err), uploadStatus: 0 });
    }
  }, [publishDiag]);

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', fontFamily: 'monospace', padding: 16 }}>
      <h1>Recorder spike (spike #1 — MediaRecorder dưới React)</h1>
      <p data-testid="rec-state">state: {recState} · {elapsed}s</p>
      {error && <p data-testid="rec-error" style={{ color: 'crimson' }}>{error}</p>}
      <p>
        <button data-testid="btn-start" onClick={start} disabled={recState === 'recording'}>Bắt đầu ghi âm</button>{' '}
        <button data-testid="btn-stop" onClick={stop} disabled={recState !== 'recording'}>Dừng</button>{' '}
        <button data-testid="btn-reset" onClick={reset}>Ghi lại</button>{' '}
        <button data-testid="btn-upload" onClick={upload} disabled={recState !== 'recorded'}>Upload → grade</button>
      </p>
      {blobUrlRef.current && recState === 'recorded' && (
        <audio data-testid="playback" controls src={blobUrlRef.current} />
      )}
      {uploadResult && <p data-testid="upload-result">{uploadResult}</p>}
      <pre data-testid="diag" style={{ background: '#f5f5f5', padding: 8, whiteSpace: 'pre-wrap' }}>
        {JSON.stringify(diag, null, 2)}
      </pre>
      <p style={{ opacity: 0.6 }}>
        Manual protocol (Safari/iOS): mở trang này → Bắt đầu → nói 5s → Dừng → nghe lại
        → kiểm tra diag.blobType (Safari phải là audio/mp4) → đóng tab giữa lúc ghi →
        indicator mic phải tắt.
      </p>
    </div>
  );
}
