'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getBrowserJsonAt, postBrowserJsonAt } from '@/lib/browser-api';
import { VocabularyAudioButton } from '@/components/vocabulary-audio-button';
import { VocabularyAccount, VocabularyNav, useVocabularyResource, useAlive, VocabError, modeLabels, messageOf } from '@/components/vocabulary-workspace';
import type { components } from '@/types/api';
type AnswerRequest = components['schemas']['StudyAnswer'];
type TestRequest = components['schemas']['TestSubmit'];

export function VocabularyStudy({ sessionId }: { sessionId: string }) {
  return <VocabularyAccount>{key => <Study key={`${key}:${sessionId}`} sessionId={sessionId} account={key} />}</VocabularyAccount>;
}

function Study({ sessionId, account }: { sessionId: string; account: string }) {
  const resource = useVocabularyResource('/api/vocabulary-sets/sessions/{session_id}', `/api/vocabulary-sets/sessions/${encodeURIComponent(sessionId)}`);
  const session = resource.data;
  const [flipped, setFlipped] = useState(false);
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [feedbackIndex, setFeedbackIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AnswerRequest | TestRequest | null>(null);
  const refreshAfterConflict = useRef(false);
  const alive = useAlive();
  const key = `vocab-study:${account}:${sessionId}`;
  useEffect(() => {
    try { const value = JSON.parse(sessionStorage.getItem(key) || '{}'); setInputs(value.inputs || {}); pending.current = value.pending || null; } catch { /* not canonical */ }
  }, [key]);
  useEffect(() => {
    if (!session || !pending.current) return;
    const request = pending.current;
    // Reload reconciles a lost ACK with canonical accepted work before sending
    // a new answer. Never replace newer session state with an older receipt.
    const accepted = 'answers' in request ? session.completed : session.answers.some(a => a.index === request.index);
    if (accepted) {
      pending.current = null;
      try { sessionStorage.setItem(key, JSON.stringify({ inputs, pending: null })); } catch {}
    }
  }, [session, key, inputs]);
  function remember(next: Record<number, string>, request = pending.current) {
    try { sessionStorage.setItem(key, JSON.stringify({ inputs: next, pending: request })); } catch { /* server ACK remains authoritative */ }
  }
  function input(index: number, value: string) { const next = { ...inputs, [index]: value }; setInputs(next); remember(next); }
  async function send(rating?: AnswerRequest['rating']) {
    if (!session || busy) return;
    setBusy(true); setError('');
    try {
      const request = pending.current ||= session.mode === 'test'
        ? { client_id: crypto.randomUUID(), answers: session.items.map((_, i) => inputs[i] || '') }
        : { client_id: crypto.randomUUID(), index: session.answers.length, answer: inputs[session.answers.length] || '', rating: rating || null };
      remember(inputs, request);
      const result = 'answers' in request
        ? await postBrowserJsonAt('/api/vocabulary-sets/sessions/{session_id}/submit', `/api/vocabulary-sets/sessions/${sessionId}/submit`, request)
        : await postBrowserJsonAt('/api/vocabulary-sets/sessions/{session_id}/answers', `/api/vocabulary-sets/sessions/${sessionId}/answers`, request);
      if (!alive.current) return;
      resource.setData(result); pending.current = null; remember(inputs, null); setFlipped(false);
      if (session.mode !== 'test' && session.mode !== 'flashcards' && 'index' in request) setFeedbackIndex(request.index);
    } catch (e) {
      if (alive.current) {
        refreshAfterConflict.current = typeof e === 'object' && e !== null && 'status' in e && e.status === 409;
        setError(messageOf(e));
      }
    }
    finally { if (alive.current) setBusy(false); }
  }
  async function retry() {
    if (busy) return;
    if (!refreshAfterConflict.current) { void send(); return; }
    setBusy(true);
    try {
      const canonical = await getBrowserJsonAt('/api/vocabulary-sets/sessions/{session_id}', `/api/vocabulary-sets/sessions/${encodeURIComponent(sessionId)}`);
      if (!alive.current) return;
      const request = pending.current;
      const accepted = request && ('answers' in request ? canonical.completed : canonical.answers.some(a => a.index === request.index));
      resource.setData(canonical);
      refreshAfterConflict.current = false;
      if (accepted) {
        pending.current = null; remember(inputs, null); setFeedbackIndex(null); setFlipped(false); setError('');
      } else {
        // Preserve the original client ID when the server has not accepted it.
        setError('Phiên chưa ghi yêu cầu này. Thử lại để lưu cùng yêu cầu.');
      }
    } catch (e) { if (alive.current) setError(messageOf(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  const feedback = session?.answers.find(a => a.index === feedbackIndex);
  const index = feedbackIndex ?? session?.answers.length ?? 0;
  const item = session?.items[index];
  const lock = busy || !!error;
  return <main className="vs-workspace"><VocabularyNav active="sets" /><div className="vs-player">
    {resource.error ? <VocabError message={resource.error} retry={resource.retry} /> : !session ? <p role="status">Đang tải phiên học…</p> : <>
      <Link href={`/vocabulary/sets/${session.set_id}`}>← Trở về bộ từ</Link><header className="vs-section"><p className="vs-eyebrow">{modeLabels[session.mode]} · bản {session.revision}</p><h1>{session.title}</h1><p className="vs-meta">Đã lưu {session.answers.length}/{session.items.length} {session.mode === 'flashcards' ? 'thẻ' : 'câu'}</p></header>
      {error && <VocabError message={error} retry={() => void retry()} />}
      {session.completed && feedbackIndex === null ? <section className="vs-hero" role="status"><h2>Phiên học đã hoàn tất</h2><p>{session.mode === 'flashcards' ? `${session.items.length} thẻ đã tự đánh giá; mức độ nhớ tách riêng với kết quả trả lời.` : `${session.correct}/${session.items.length} câu đúng. Kết quả đã lưu vào tài khoản.`}</p><Link className="av-button av-button-primary" href={`/vocabulary/sets/${session.set_id}`}>Chọn cách học tiếp</Link></section> : session.mode === 'test' ? <form onSubmit={e => { e.preventDefault(); void send(); }} className="vs-panel"><h2>Trả lời các câu sau</h2><p className="vs-meta">Nhập từ tiếng Anh tương ứng. Nộp toàn bộ để nhận đáp án và kết quả.</p>{session.items.map((q, i) => <label key={q.card_id}>{i + 1}. {q.prompt}<input value={inputs[i] || ''} onChange={e => input(i, e.target.value)} maxLength={200} autoComplete="off" disabled={lock} /></label>)}<button type="submit" className="av-button-primary" disabled={lock}>{busy ? 'Đang lưu bài…' : 'Nộp bài kiểm tra'}</button></form> : item && <section aria-label={`Câu ${index + 1}`}>
        {session.mode === 'flashcards' ? <>
          <button type="button" className="vs-flip" aria-label={flipped ? 'Xem mặt từ' : 'Lật thẻ xem nghĩa'} onClick={() => setFlipped(v => !v)} disabled={lock}>
            {flipped ? <><strong>{item.card?.gloss_vi || item.card?.definition_en || 'Chưa có nghĩa'}</strong>{item.card?.example && <span>{item.card.example}</span>}</> : <><strong>{item.card?.headword}</strong><span>{item.card?.pronunciation}</span><span className="vs-meta">Nhấn để lật thẻ</span></>}
          </button>
          <div className="vs-actions">
            <VocabularyAudioButton url={item.card?.audio_headword} say={item.card?.headword} label="Nghe phát âm từ" className="av-button">Nghe từ</VocabularyAudioButton>
            {item.card?.example && <VocabularyAudioButton url={item.card.audio_example} say={item.card.example} label="Nghe câu ví dụ" className="av-button">Nghe câu ví dụ</VocabularyAudioButton>}
          </div>
          <p className="vs-meta">Tự đánh giá để lưu lịch ôn. Đây không phải điểm kiểm tra.</p><div className="vs-actions">{([['again', 'Chưa nhớ'], ['hard', 'Khó nhớ'], ['good', 'Nhớ'], ['easy', 'Rất dễ']] as const).map(([rating, label]) => <button key={rating} disabled={lock || !flipped} onClick={() => void send(rating)}>{label}</button>)}</div>
        </> : <form className="vs-panel" onSubmit={e => { e.preventDefault(); void send(); }}><label>{index + 1}. {item.prompt}<input autoFocus value={inputs[index] || ''} onChange={e => input(index, e.target.value)} disabled={lock || !!feedback} maxLength={200} autoComplete="off" /></label>{!feedback && <button type="submit" className="av-button-primary" disabled={lock || !inputs[index]?.trim()}>{busy ? 'Đang lưu…' : 'Kiểm tra và lưu'}</button>}</form>}
        {feedback && <div className="vs-feedback" role="status"><strong>{feedback.correct ? 'Đúng' : 'Chưa đúng'}</strong><p>Đáp án: {feedback.expected}</p><button className="av-button-primary" onClick={() => { setFeedbackIndex(null); setFlipped(false); }}>{session.completed ? 'Xem kết quả' : 'Câu tiếp theo'}</button></div>}
      </section>}
      {session.answers.length > 0 && <details className="vs-section"><summary>Các câu/thẻ đã lưu ({session.answers.length})</summary><ul className="vs-card-list">{session.answers.map(a => <li key={a.index}><div><strong>{a.index + 1}. {a.expected}</strong><p className="vs-meta">{a.rating ? `Tự đánh giá: ${a.rating}` : `${a.correct ? 'Đúng' : 'Chưa đúng'} · câu trả lời: ${a.answer || '(bỏ trống)'}`}</p></div></li>)}</ul></details>}
    </>}
  </div></main>;
}
