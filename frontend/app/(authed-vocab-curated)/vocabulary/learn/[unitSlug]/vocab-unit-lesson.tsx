'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface Task {
  id: string;
  sequence: number;
  task_type: string;
  dimension: string;
  prompt: string;
  options: Array<string | { value?: string; label?: string }>;
  explanation_vi: string;
}

interface UnitPayload {
  unit_slug: string;
  display_headword: string;
  target_level: string;
  title_vi: string;
  learning_goal_vi: string;
  content: Record<string, unknown>;
  sources: Array<{ title?: string; url?: string }>;
  tasks: Task[];
}

interface AttemptResult {
  correct: boolean;
  score: number;
  duplicate: boolean;
  feedback_vi?: string | null;
  model_answer?: string | null;
  mastery?: { state?: string; next_review_at?: string } | null;
}

function newAttemptId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function text(content: Record<string, unknown>, key: string): string {
  return typeof content[key] === 'string' ? String(content[key]) : '';
}

function Examples({ value }: { value: unknown }) {
  if (!Array.isArray(value)) return null;
  return <div className="vc-examples">{value.map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const example = item as { en?: unknown; vi?: unknown; note_vi?: unknown };
    return <article key={index}><strong>{String(example.en || '')}</strong><p>{String(example.vi || '')}</p>{example.note_vi ? <small>{String(example.note_vi)}</small> : null}</article>;
  })}</div>;
}

function TaskCard({ task }: { task: Task }) {
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [error, setError] = useState('');
  const options = useMemo(() => Array.isArray(task.options) ? task.options.map((option) => typeof option === 'string'
    ? { value: option, label: option }
    : { value: String(option?.value || ''), label: String(option?.label || option?.value || '') }).filter((option) => option.value) : [], [task.options]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!answer.trim() || pending) return;
    setPending(true); setError('');
    try {
      const ready = await whenGlobalReady(() => !!window.api?.post, 'window.api (vocab unit attempt)');
      if (!ready) throw new Error('api unavailable');
      const payload = await window.api.post<AttemptResult>(
        `/api/vocabulary/tasks/${encodeURIComponent(task.id)}/attempt`,
        { attempt_id: newAttemptId(), response: { answer: answer.trim() } },
      );
      setResult(payload);
    } catch {
      setError('Chưa lưu được câu trả lời. Hãy thử lại.');
    } finally {
      setPending(false);
    }
  }

  return <article className="vc-task">
    <div className="vc-task-label"><span>Bước {task.sequence}</span><span>{task.dimension.replaceAll('_', ' ')}</span></div>
    <h3>{task.prompt}</h3>
    <form onSubmit={submit}>
      {options.length ? <div className="vc-options">{options.map((option) => <label key={option.value}><input type="radio" name={`task-${task.id}`} value={option.value} checked={answer === option.value} onChange={() => { setAnswer(option.value); setResult(null); }} /> <span>{option.label}</span></label>)}</div>
        : task.task_type === 'productive_transfer' ? <textarea value={answer} onChange={(event) => { setAnswer(event.target.value); setResult(null); }} maxLength={1200} rows={4} placeholder="Viết hoặc nhập câu bạn sẽ nói…" />
          : <input value={answer} onChange={(event) => { setAnswer(event.target.value); setResult(null); }} maxLength={1200} placeholder="Câu trả lời của bạn" />}
      <button className="av-button av-button-primary" type="submit" disabled={!answer.trim() || pending}>{pending ? 'Đang chấm…' : 'Kiểm tra'}</button>
    </form>
    {error ? <p className="vc-task-result is-error" role="alert">{error}</p> : null}
    {result ? <div className={`vc-task-result ${result.correct ? 'is-correct' : 'is-retry'}`} role="status">
      <strong>{result.correct ? 'Đã dùng đúng' : 'Chưa ổn — sửa ngay lúc này'}</strong>
      <p>{result.feedback_vi || task.explanation_vi}</p>
      {!result.correct && result.model_answer ? <p><b>Mẫu tham khảo:</b> {result.model_answer}</p> : null}
      {result.mastery?.state ? <small>Trạng thái: {result.mastery.state.replaceAll('_', ' ')}</small> : null}
    </div> : null}
  </article>;
}

export function VocabUnitLesson({ unitSlug }: { unitSlug: string }) {
  const { status } = useAuth();
  const [unit, setUnit] = useState<UnitPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'signed-out') { window.location.replace('/login'); return; }
    if (status !== 'signed-in') return;
    const controller = new AbortController();
    let disposed = false;
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (vocab unit)');
      if (!ready || disposed) return;
      try {
        const [me, payload] = await Promise.all([
          window.api.getWith<{ vocab_curated_enabled?: unknown }>('/auth/me', undefined, { signal: controller.signal }),
          window.api.getWith<UnitPayload>(`/api/vocabulary/units/${encodeURIComponent(unitSlug)}`, undefined, { signal: controller.signal }),
        ]);
        if (disposed) return;
        if (me?.vocab_curated_enabled !== true) { setError('Learning unit này chưa mở cho tài khoản của bạn.'); return; }
        setUnit(payload);
      } catch (caught: unknown) {
        if (!disposed && !(caught instanceof DOMException && caught.name === 'AbortError')) setError('Không tải được learning unit này.');
      }
    })();
    return () => { disposed = true; controller.abort(); };
  }, [status, unitSlug]);

  if (error) return <section className="vc-state is-error" role="alert"><h1>Chưa thể mở bài học</h1><p>{error}</p><a className="av-button av-button-primary" href="/vocabulary/learn">Quay lại</a></section>;
  if (!unit) return <section className="vc-state" aria-live="polite">Đang tải learning unit…</section>;
  const content = unit.content || {};
  return <div className="vc-lesson">
    <header className="vc-lesson-hero"><div><p>{unit.target_level} · Learning unit</p><h1>{unit.title_vi || unit.display_headword}</h1><strong>{unit.learning_goal_vi}</strong></div><span>{unit.display_headword}</span></header>
    <section className="vc-concept-grid">
      <article><span>Meaning</span><h2>{text(content, 'meaning_vi')}</h2><p>{text(content, 'sense')}</p></article>
      <article><span>Construction</span><h2>{text(content, 'construction')}</h2><p>{text(content, 'usage_vi')}</p></article>
      <article className="is-problem"><span>Vietnamese learner clinic</span><h2>Vì sao dễ dùng sai?</h2><p>{text(content, 'why_vietnamese_learners_struggle')}</p></article>
      <article><span>Contrast</span><h2>Đừng chỉ nhớ nghĩa tiếng Việt</h2><p>{text(content, 'contrast_vi')}</p></article>
    </section>
    <section className="vc-lesson-section"><p className="vc-eyebrow">Context diversity</p><h2>Nhìn cấu trúc hoạt động trong nhiều ngữ cảnh</h2><Examples value={content.examples} /></section>
    <section className="vc-lesson-section"><p className="vc-eyebrow">Active practice</p><h2>Gọi lại → kiểm soát → tự tạo câu</h2><div className="vc-task-list">{unit.tasks.map((task) => <TaskCard task={task} key={task.id} />)}</div></section>
    <aside className="vc-memory"><span>Memory hook</span><p>{text(content, 'memory_hook_vi')}</p></aside>
    {unit.sources?.length ? <footer className="vc-sources"><strong>Nguồn biên tập</strong>{unit.sources.map((source, index) => source.url?.startsWith('https://') ? <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}:${index}`}>{source.title || source.url}</a> : null)}</footer> : null}
  </div>;
}
