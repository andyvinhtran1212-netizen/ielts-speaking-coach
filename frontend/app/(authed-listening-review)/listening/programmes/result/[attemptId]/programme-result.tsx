'use client';

import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { createProgrammeReplayController } from '@/lib/listening-programme-replay.mjs';
import type { ListeningProgrammeReviewWire } from '@/lib/listening-programmes-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface ReviewItem { qNum: number; state: string; correct: boolean | null; userAnswer: string; firstAnswer: string | null; expected: string | string[]; prompt: string; responseType: string; audioWindow?: { start?: number; end?: number }; solution: Record<string, unknown>; selfReview: Record<string, unknown> }
interface Result { title: string; programmeId: string; lessonId: string; audioUrl: string; assisted: boolean; summary: Record<string, number>; review: ReviewItem[]; transcripts: Record<string, Array<Record<string, unknown>>> }
type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; result: Result };
function row(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function list(value: unknown): string[] { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }

export function ProgrammeResult({ attemptId }: { attemptId: string }) {
  const { status, user } = useAuth(); const [state, setState] = useState<State>({ status: 'loading' }); const [audioError, setAudioError] = useState(''); const audio = useRef<HTMLAudioElement>(null);
  const replayController = useRef<ReturnType<typeof createProgrammeReplayController> | null>(null);
  if (!replayController.current) replayController.current = createProgrammeReplayController(() => audio.current);
  useEffect(() => () => replayController.current?.dispose(), []);
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
    if (status !== 'signed-in' || !user?.id) return;
    const controller = new AbortController(); let active = true;
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (programme result)'); if (!ready || !active) throw new Error();
      const payload = row(await window.api.getWith<ListeningProgrammeReviewWire>(`/api/listening/tests/attempts/${encodeURIComponent(attemptId)}/review`, undefined, { signal: controller.signal }));
      if (payload.scoring_policy !== 'report_only') throw new Error();
      const review = (Array.isArray(payload.review) ? payload.review : []).map((value) => { const item = row(value); return { qNum: Number(item.q_num), state: String(item.state || (item.correct == null ? 'unscored' : 'checked')), correct: typeof item.correct === 'boolean' ? item.correct : null, userAnswer: String(item.user_answer || ''), firstAnswer: item.first_answer == null ? null : String(item.first_answer), expected: item.expected as string | string[], prompt: String(item.prompt || ''), responseType: String(item.question_type || ''), audioWindow: row(item.audio_window) as ReviewItem['audioWindow'], solution: row(item.solution), selfReview: row(item.self_review) }; });
      const summaryRaw = row(payload.result_summary); const summary: Record<string, number> = {}; for (const [key, value] of Object.entries(summaryRaw)) summary[key] = Number(value || 0);
      if (active) setState({ status: 'ready', result: { title: String(payload.title || 'Kết quả luyện nghe'), programmeId: String(payload.programme_id || ''), lessonId: String(payload.listening_lesson_id || ''), audioUrl: String(payload.audio_url || ''), assisted: payload.assisted === true, summary, review, transcripts: row(payload.controlled_transcripts) as Result['transcripts'] } });
    })().catch(() => { if (active) setState({ status: 'error' }); });
    return () => { active = false; controller.abort(); };
  }, [attemptId, status, user?.id]);
  function replay(item: ReviewItem) { setAudioError(''); void replayController.current?.replay(item.audioWindow).then((started) => { if (!started) setAudioError('Không phát được đoạn nghe. Bạn có thể thử lại.'); }); }
  if (state.status === 'loading') return <main className="programme-result programme-result-state" role="status">Đang tải phần tự đối chiếu…</main>;
  if (state.status === 'error') return <main className="programme-result programme-result-state is-error" role="alert"><p>Không tải được kết quả.</p><a href="/listening">Về trang Luyện nghe</a></main>;
  const { result } = state; const summary = result.summary; const lessonProgrammePath = result.programmeId === 'general-listening-practice' ? 'general' : 'ielts';
  return <main className="programme-result">
    <audio ref={audio} src={result.audioUrl} preload="metadata" onError={() => setAudioError('Không tải được audio. Hãy thử lại sau.')} />
    {audioError ? <p className="programme-result__audio-error" role="alert">{audioError}</p> : null}
    <header className="programme-result__hero"><p>{result.assisted ? 'Hoàn thành có hỗ trợ' : 'Tự đối chiếu sau bài luyện'}</p><h1>{result.title}</h1><div><a href={result.lessonId ? `/listening/${lessonProgrammePath}/${result.lessonId}` : '/listening'}>← Quay lại bài học</a><span>Hoàn thành {summary.completion_count || 0}/{summary.item_count || result.review.length} câu</span></div></header>
    <section className="programme-result__notice"><strong>Đây không phải điểm IELTS.</strong><span>{result.assisted ? 'Bạn đã xem đối chiếu trong lúc làm. Số câu đúng dưới đây là bản cuối sau khi sửa, không phải kết quả làm độc lập.' : 'Câu lựa chọn/bản đồ được kiểm tra chính xác; câu viết được giữ nguyên để bạn tự so với gợi ý.'}</span></section>
    <section className="programme-result__summary" aria-label="Tóm tắt kết quả"><div><strong>{summary.correct_count || 0}/{summary.checked_count || 0}</strong><span>{result.assisted ? 'Câu đúng trong bản cuối có hỗ trợ' : 'Câu được kiểm tra đúng'}</span></div><div><strong>{summary.unscored_count || 0}</strong><span>Câu tự đối chiếu</span></div><div><strong>{summary.blank_count || 0}</strong><span>Câu để trống</span></div>{summary.technical_error_count ? <div className="is-error"><strong>{summary.technical_error_count}</strong><span>Lỗi kỹ thuật</span></div> : null}</section>
    <section className="programme-result__items"><h2>Đối chiếu từng câu</h2>{result.review.map((item) => { const references = list(item.selfReview.reference_answers); const facts = list(item.selfReview.required_facts); const expected = Array.isArray(item.expected) ? item.expected : item.expected ? [String(item.expected)] : list(item.solution.expected); return <article className="programme-review-item" data-state={item.state} key={item.qNum}><header><span>{item.qNum}</span><div><h3>{item.prompt}</h3><p>{item.state === 'checked' ? item.correct ? 'Đúng' : 'Chưa đúng' : item.state === 'unscored' ? 'Tự đối chiếu' : item.state === 'blank' ? 'Để trống' : 'Cần thử lại sau'}</p></div>{item.audioWindow?.start != null ? <button type="button" onClick={() => replay(item)}>▶ Nghe đoạn liên quan</button> : null}</header>{item.firstAnswer !== null ? <div className="programme-review-item__first"><span>Câu trả lời đầu trước đối chiếu</span><p>{item.firstAnswer}</p></div> : null}<div className="programme-review-item__answer"><span>{item.firstAnswer !== null ? 'Bản cuối sau khi sửa' : 'Câu trả lời của bạn'}</span><p>{item.userAnswer || '—'}</p></div>{expected.length ? <div className="programme-review-item__reference"><span>Đáp án đối chiếu</span><p>{expected.join(' · ')}</p>{item.solution.rationale ? <small>{String(item.solution.rationale)}</small> : null}</div> : null}{item.state === 'unscored' ? <div className="programme-review-item__reference"><span>Gợi ý tự kiểm tra</span>{references.length ? <p>{references.join(' · ')}</p> : null}{facts.length ? <ul>{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : null}{item.selfReview.rationale ? <small>{String(item.selfReview.rationale)}</small> : null}</div> : null}</article>; })}</section>
    {Object.keys(result.transcripts).length ? <details className="programme-transcript"><summary>Transcript tham khảo sau khi nộp</summary>{Object.entries(result.transcripts).map(([id, segments]) => <section key={id}><h3>{id}</h3>{segments.map((segment, index) => <p key={`${id}-${index}`}><span>{segment.speaker_id ? `${String(segment.speaker_id)}: ` : ''}</span>{String(segment.text || '')}</p>)}</section>)}</details> : null}
  </main>;
}
