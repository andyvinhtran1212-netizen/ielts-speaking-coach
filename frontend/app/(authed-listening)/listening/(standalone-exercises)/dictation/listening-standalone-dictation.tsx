'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  normalizeStandaloneDictationBoot,
  normalizeStandaloneDictationResult,
  standaloneDictationParams,
  summarizeStandaloneDictation,
} from '@/lib/listening-standalone-dictation-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Phase = 'loading' | 'missing-content' | 'empty' | 'ready' | 'complete' | 'error';
type AudioElement = HTMLElement & { pause?: () => void; reset?: () => void };

function statusOf(error: unknown): number | null {
  const status = Number((error as { status?: unknown } | null)?.status);
  return Number.isInteger(status) ? status : null;
}

function FeedbackBridge({ hostRef, contentId }: {
  hostRef: React.RefObject<HTMLElement | null>;
  contentId: string;
}) {
  useEffect(() => {
    let disposed = false;
    void whenGlobalReady(
      () => typeof (window as any).AverFeedback?.attachCardFlag === 'function',
      'AverFeedback (Listening standalone dictation)',
    ).then((ready) => {
      if (!disposed && ready && hostRef.current) {
        (window as any).AverFeedback.attachCardFlag({
          card: hostRef.current, top: hostRef.current, skill: 'listening',
          contentId, label: 'Báo lỗi bài này',
        });
      }
    });
    return () => { disposed = true; };
  }, [contentId, hostRef]);
  return null;
}

export function ListeningStandaloneDictation() {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);
  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  const contentId = standaloneDictationParams(searchParams?.toString() || '').contentId;
  return <AccountDictation
    accountKey={accountKey}
    contentId={contentId}
    key={`${accountKey || status}:dictation:${contentId || 'picker'}`}
  />;
}

function AccountDictation({ accountKey, contentId }: {
  accountKey: string | null;
  contentId: string | null;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [bundle, setBundle] = useState<any>(null);
  const [loadMessage, setLoadMessage] = useState('');
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [results, setResults] = useState<any[]>([]);
  const [answer, setAnswer] = useState('');
  const [listenCount, setListenCount] = useState(0);
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [completionTab, setCompletionTab] = useState<'results' | 'transcript'>('results');
  const [resultVisible, setResultVisible] = useState(false);
  const audioRef = useRef<AudioElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    return () => { liveRef.current = false; };
  }, []);

  useEffect(() => {
    if (!accountKey) return undefined;
    if (!contentId) {
      setBundle(null);
      setPhase('missing-content');
      return undefined;
    }
    const controller = new AbortController();
    let disposed = false;
    setPhase('loading');
    setBundle(null);
    setLoadMessage('');
    setSubmitError('');
    (async () => {
      const ready = await whenGlobalReady(
        () => typeof window.api?.getWith === 'function',
        'window.api (Listening standalone dictation)',
      );
      if (!ready || disposed) {
        if (!disposed) setPhase('error');
        return;
      }
      try {
        const raw = await window.api.getWith<unknown>(
          `/api/listening/dictation/${encodeURIComponent(contentId)}/boot`,
          {}, { noRedirect: true, signal: controller.signal },
        );
        const normalized = normalizeStandaloneDictationBoot(contentId, raw);
        if (disposed) return;
        if (!normalized) {
          setPhase('empty');
          return;
        }
        setBundle(normalized);
        setSegmentIndex(0);
        setResults(new Array(normalized.exercise.segments.length).fill(null));
        setAnswer('');
        setListenCount(0);
        setResultVisible(false);
        setCompletionTab('results');
        setPhase('ready');
      } catch (error: unknown) {
        if (disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
        const status = statusOf(error);
        if (status === 401) {
          window.location.replace('/login');
          return;
        }
        setLoadMessage(status === 404
          ? 'Bài nghe không tồn tại hoặc chưa được công khai.'
          : 'Không tải được bài chép chính tả. Vui lòng thử lại.');
        setPhase('error');
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, contentId]);

  useEffect(() => {
    const player = audioRef.current;
    if (!player || phase !== 'ready') return undefined;
    const onPlay = () => setListenCount((count) => count + 1);
    player.addEventListener('av-audio-play', onPlay);
    return () => player.removeEventListener('av-audio-play', onPlay);
  }, [bundle, phase, segmentIndex]);

  const segment = bundle?.exercise.segments[segmentIndex] || null;
  const currentResult = results[segmentIndex] || null;
  const metadata = useMemo(() => bundle ? [
    bundle.content.accent?.replace('_', ' '),
    bundle.content.cefr,
    bundle.content.section ? `Section ${bundle.content.section}` : '',
    ...bundle.content.topics,
  ].filter(Boolean) : [], [bundle]);

  const submit = useCallback(async () => {
    if (!bundle || !segment || busy || resultVisible) return;
    if (!answer.trim()) {
      setSubmitError('Hãy gõ câu trả lời trước khi kiểm tra.');
      return;
    }
    const owner = accountKey;
    const expectedSegmentIdx = segment.idx;
    setBusy(true);
    setSubmitError('');
    try {
      const raw = await window.api.postWith<unknown>('/api/listening/attempts', {
        exercise_id: bundle.exercise.id,
        content_id: bundle.content.id,
        mode: 'dictation',
        segment_idx: segment.idx,
        user_transcript: answer,
        listen_count: Math.max(1, listenCount),
      }, {}, { noRedirect: true });
      if (!liveRef.current || owner !== accountKey) return;
      const normalized = normalizeStandaloneDictationResult(
        bundle.exercise.id, expectedSegmentIdx, raw,
      );
      setResults((current) => current.map((result, index) => (
        index === segmentIndex ? normalized : result
      )));
      setResultVisible(true);
    } catch (error: unknown) {
      if (!liveRef.current || owner !== accountKey) return;
      if (statusOf(error) === 401) {
        window.location.replace('/login');
        return;
      }
      setSubmitError('Không xác nhận được kết quả. Bài có thể đã được ghi; hệ thống sẽ không tự gửi lại.');
    } finally {
      if (liveRef.current && owner === accountKey) setBusy(false);
    }
  }, [accountKey, answer, bundle, busy, listenCount, resultVisible, segment, segmentIndex]);

  const tryAgain = useCallback(() => {
    setResultVisible(false);
    setSubmitError('');
  }, []);

  const advance = useCallback(() => {
    if (!resultVisible || !currentResult || !bundle) return;
    if (segmentIndex + 1 >= bundle.exercise.segments.length) {
      setPhase('complete');
      return;
    }
    try { audioRef.current?.pause?.(); audioRef.current?.reset?.(); } catch {}
    setSegmentIndex((index) => index + 1);
    setAnswer('');
    setListenCount(0);
    setSubmitError('');
    setResultVisible(false);
  }, [bundle, currentResult, resultVisible, segmentIndex]);

  const restart = useCallback(() => {
    if (!bundle) return;
    try { audioRef.current?.pause?.(); audioRef.current?.reset?.(); } catch {}
    setSegmentIndex(0);
    setResults(new Array(bundle.exercise.segments.length).fill(null));
    setAnswer('');
    setListenCount(0);
    setSubmitError('');
    setResultVisible(false);
    setCompletionTab('results');
    setPhase('ready');
  }, [bundle]);

  const summary = phase === 'complete' ? summarizeStandaloneDictation(results) : null;

  return <div className="shell"><main className="lse-shell is-dictation">
    <header className="lse-header" ref={headerRef}>
      <p className="lse-eyebrow"><a href="/listening/browse">← Kho bài nghe</a><span>LUYỆN NGHE TỪNG CÂU</span></p>
      <h1>Chép chính tả<span aria-hidden="true"> · </span><strong>{bundle?.content.title || '…'}</strong></h1>
      <p>Nghe từng đoạn ngắn, gõ lại câu bạn nghe được rồi đối chiếu sau khi nộp. Đáp án không được tải xuống trước lượt làm.</p>
      {bundle ? <FeedbackBridge hostRef={headerRef} contentId={bundle.content.id} /> : null}
    </header>

    {phase === 'loading' ? <section className="lse-state" role="status">Đang tải bài chép chính tả…</section> : null}
    {phase === 'missing-content' ? <section className="lse-state" role="status"><strong>Chưa chọn bài nghe.</strong><span>Hãy mở dạng Chép chính tả từ Kho bài nghe.</span><a href="/listening/browse">Mở Kho bài nghe</a></section> : null}
    {phase === 'empty' ? <section className="lse-state" role="status"><strong>Bài này chưa được phân câu.</strong><span>Quản trị viên cần chia transcript thành các đoạn có thời gian trước khi xuất bản.</span><a href="/listening/browse">Chọn bài khác</a></section> : null}
    {phase === 'error' ? <section className="lse-state is-error" role="alert"><strong>{loadMessage || 'Không tải được bài chép chính tả. Vui lòng thử lại.'}</strong><a href="/listening/browse">Quay lại Kho bài nghe</a></section> : null}

    {phase === 'ready' && bundle && segment ? <>
      {metadata.length ? <div className="lse-dictation-meta" aria-label="Thông tin bài nghe">{metadata.map((item: string) => <span key={item}>{item}</span>)}</div> : null}
      <section className="lse-dictation-progress" aria-label="Tiến độ từng câu">
        <div><span>CÂU ĐANG LÀM</span><strong>{segmentIndex + 1} / {bundle.exercise.segments.length}</strong></div>
        <ol>{bundle.exercise.segments.map((item: any, index: number) => {
          const result = results[index];
          const state = index === segmentIndex ? 'is-current' : result
            ? (result.isCorrect ? 'is-correct' : result.score >= .5 ? 'is-partial' : 'is-incorrect') : '';
          return <li className={state} key={item.idx} aria-label={`Câu ${index + 1}`} />;
        })}</ol>
      </section>
      <section className="lse-player" aria-label={`Audio câu ${segmentIndex + 1}`}>
        <div><span>Đoạn {segmentIndex + 1}</span><small>Số lượt nghe: {listenCount}</small></div>
        <audio-player
          ref={(node) => { audioRef.current = node as AudioElement | null; }}
          key={`${bundle.content.id}:${segment.idx}`}
          src={bundle.content.audioUrl}
          duration-hint={bundle.content.durationSeconds}
          segment-start={segment.start}
          segment-end={segment.end}
          auto-loop="true"
          refetch-url={`/api/listening/content/${encodeURIComponent(bundle.content.id)}`}
        />
      </section>
      <section className="lse-gist lse-dictation-answer">
        <label htmlFor="lse-dictation-answer">Câu bạn nghe được</label>
        <textarea id="lse-dictation-answer" value={answer} disabled={busy || resultVisible} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); resultVisible ? advance() : void submit(); } }} placeholder="Gõ nguyên câu bằng tiếng Anh…" autoComplete="off" spellCheck={false} />
      </section>
      {resultVisible && currentResult ? <DictationResult result={currentResult} /> : null}
      {submitError ? <div className="lse-submit-error" role="alert">{submitError}</div> : null}
      <div className="lse-actions">
        {!resultVisible ? <button type="button" className="lse-primary" disabled={busy} onClick={submit}>{busy ? 'Đang chấm…' : 'Kiểm tra'}</button> : null}
        {resultVisible ? <button type="button" className="lse-secondary" onClick={tryAgain}>Thử lại câu này</button> : null}
        {resultVisible ? <button type="button" className="lse-primary" onClick={advance}>{segmentIndex + 1 < bundle.exercise.segments.length ? 'Câu tiếp theo →' : 'Xem kết quả'}</button> : null}
        {resultVisible && currentResult ? <strong className={currentResult.isCorrect ? 'is-perfect' : ''}>{Math.round(currentResult.score * 100)}% · {currentResult.correctWords}/{currentResult.totalWords}</strong> : null}
      </div>
    </> : null}

    {phase === 'complete' && bundle && summary ? <Completion
      bundle={bundle} results={results} summary={summary} tab={completionTab}
      onTab={setCompletionTab} onRestart={restart}
    /> : null}
  </main></div>;
}

function DictationResult({ result }: { result: any }) {
  return <section className="lse-dictation-diff" aria-label="Đối chiếu câu trả lời">
    <span>{result.firstAttempt ? 'Đối chiếu · lần đầu đã ghi điểm chính thức' : 'Đối chiếu · lần làm thêm, điểm chính thức giữ ở lần đầu'}</span>
    <p>{result.diff.map((operation: any, index: number) => <DiffToken key={`${index}:${operation.op}`} operation={operation} />)}</p>
  </section>;
}

function DiffToken({ operation }: { operation: any }) {
  if (operation.op === 'match') return <em className="is-match">{operation.actual}</em>;
  if (operation.op === 'miss') return <em className="is-miss" title="Thiếu từ">{operation.expected}</em>;
  if (operation.op === 'wrong') return <em className="is-wrong" title="Sai từ"><del>{operation.actual}</del>{operation.expected}</em>;
  return <em className="is-extra" title="Thừa từ"><del>{operation.actual}</del></em>;
}

function Completion({ bundle, results, summary, tab, onTab, onRestart }: any) {
  return <section className="lse-dictation-completion" aria-labelledby="lse-dictation-complete-title">
    <p className="lse-eyebrow"><span>HOÀN THÀNH LƯỢT LUYỆN</span></p>
    <h2 id="lse-dictation-complete-title">Bạn đã làm đủ {summary.totalSegments} câu</h2>
    <div className="lse-dictation-score"><strong>{Math.round(summary.averageScore * 100)}%</strong><span>{summary.correctSegments}/{summary.totalSegments} câu chính xác hoàn toàn</span></div>
    <p className="lse-dictation-official">{summary.firstAttemptSegments === summary.totalSegments
      ? 'Toàn bộ kết quả trong lượt này là điểm chính thức lần đầu.'
      : `${summary.firstAttemptSegments}/${summary.totalSegments} câu là lần đầu; các câu làm thêm không thay điểm chính thức đã lưu.`}</p>
    <div className="lse-dictation-tabs" role="tablist" aria-label="Tổng kết chép chính tả">
      <button type="button" role="tab" aria-selected={tab === 'results'} onClick={() => onTab('results')}>Kết quả</button>
      <button type="button" role="tab" aria-selected={tab === 'transcript'} onClick={() => onTab('transcript')}>Bản gỡ băng đầy đủ</button>
    </div>
    {tab === 'results' ? <ol className="lse-dictation-summary">{results.map((result: any, index: number) => <li key={result.attemptId}><div><span>Câu {index + 1}</span><strong>{Math.round(result.score * 100)}% · {result.correctWords}/{result.totalWords}</strong></div><p>{result.reference}</p></li>)}</ol> : null}
    {tab === 'transcript' ? <div className="lse-dictation-transcript">{results.map((result: any, index: number) => <section key={result.attemptId}><span>Câu {index + 1}</span><p>{result.reference}</p><div>{result.diff.map((operation: any, opIndex: number) => <DiffToken key={`${opIndex}:${operation.op}`} operation={operation} />)}</div></section>)}</div> : null}
    <div className="lse-actions"><button type="button" className="lse-primary" onClick={onRestart}>Làm lại từ đầu</button><a className="lse-secondary" href="/listening/browse">Chọn bài khác</a></div>
  </section>;
}
