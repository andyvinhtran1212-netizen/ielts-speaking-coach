'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-provider';
import type { components } from '@/types/api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Activity = components['schemas']['BlackEyeActivityPublic'];
type Player = components['schemas']['BlackEyePlayer'];
type Attempt = components['schemas']['BlackEyeAttemptState'];
type Review = components['schemas']['BlackEyeActivityReview'];
type Unit = components['schemas']['BlackEyeUnitPublic'];
const API = '/api/listening';
const LOCKS: Record<string, string> = { audio_incomplete_download: 'Audio tải chưa hoàn tất', audio_not_found: 'Chưa có audio', original_options_unreviewed: 'Chờ kiểm tra lựa chọn gốc' };

export function BlackEyeUnitList() {
  const { status, user } = useAuth();
  const [unit, setUnit] = useState<Unit | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (status !== 'signed-in') return;
    const controller = new AbortController(); let active = true;
    setError(false); setUnit(null);
    void (async () => {
      if (!await whenGlobalReady(() => !!window.api?.getWith, 'Black Eye API')) throw new Error();
      const value = await window.api.getWith<Unit>(`${API}/source-collections/blackeye-v5-upper/units/U1`, undefined, { signal: controller.signal });
      if (active) setUnit(value);
    })().catch(() => { if (active) setError(true); });
    return () => { active = false; controller.abort(); };
  }, [status, user?.id, retry]);
  if (status === 'signed-out') return <a href="/login">Đăng nhập để làm bài</a>;
  if (error) return <section role="alert">Không tải được Unit 1. <button onClick={() => setRetry(retry + 1)}>Thử lại</button></section>;
  if (!unit) return <p role="status">Đang tải Unit 1…</p>;
  return <section aria-label="Black Eye Unit 1"><h1>Black Eye · Unit 1</h1>{!unit.activities.length && <p>Chưa có bài</p>}
    {unit.activities.map((a) => { const reason = a.readiness_reasons.map(r => LOCKS[r] || 'Chưa sẵn sàng').join(' · '); return <article className="programme-review-item" key={a.binding.activity_id}><h2>{a.binding.activity_id} · {a.title}</h2><p id={`reason-${a.binding.activity_id}`}>{reason}</p>{a.selectable && a.test_id ? <a href={`/listening/programmes/form/${encodeURIComponent(a.test_id)}?blackeye=1`} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Bắt đầu</a> : <button disabled aria-describedby={`reason-${a.binding.activity_id}`} style={{ minHeight: 44 }}>Bắt đầu</button>}</article>; })}
    <p>Bổ trợ tự chọn / Chưa mở</p><button disabled>Chính tả</button>
  </section>;
}

export function blackEyeBlank(item: Activity['items'][number], value = '') {
  if (item.interaction === 'text') return !value.trim();
  if (!value) return true;
  try { const parsed = JSON.parse(value); return !parsed.action || (parsed.action === 'CHANGE' && !parsed.correction_text?.trim()); } catch { return true; }
}
function display(value: unknown): string {
  if (value == null || value === '') return 'chưa có';
  if (Array.isArray(value)) return value.map(display).join(' · ');
  if (typeof value === 'object' && 'action' in value) {
    const composite = value as { action: string; correction_text: string };
    return composite.action === 'KEEP' ? 'KEEP' : `CHANGE · ${composite.correction_text || 'chưa có'}`;
  }
  if (typeof value === 'string' && value.startsWith('{')) { try { return display(JSON.parse(value)); } catch { /* Plain text is preserved. */ } }
  return String(value);
}

export function BlackEyeReview({ review }: { review: Review }) {
  return <section className="programme-result" aria-label="Chữa bài Black Eye"><h1>Tự đối chiếu · {review.attempt.binding.activity_id}</h1><p>Không chấm điểm tự động</p><p>{review.attempt.result_summary?.blank_count} ô trống</p>
    {review.items.map(item => <article className="programme-review-item" key={item.source_item_id}><h2>Câu {item.q_num} · Tự đối chiếu</h2><p>Câu trả lời: {display(item.saved_response)}</p><p>Đáp án tham chiếu: {display(item.reference)}</p><p>Nguồn: {item.reference_provenance}</p><p>Giải thích: {item.explanation_vi || 'chưa có giải thích'}</p>{item.limitation_vi && <p>{item.limitation_vi}</p>}<p>{item.source_status} · {item.academic_verdict}</p></article>)}
    <details><summary>Transcript của activity đã nộp</summary>{review.transcript.map((t, i) => <p key={i}>{t.text}</p>)}</details>
  </section>;
}

export function BlackEyeRunner({ testId }: { testId: string }) {
  const { status, user } = useAuth(); const params = useSearchParams(); const classItem = params?.get('class_item');
  const [player, setPlayer] = useState<Player | null>(null); const [answers, setAnswers] = useState<Record<number, string>>({});
  const [save, setSave] = useState<'saved' | 'saving' | 'error'>('saved'); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [retry, setRetry] = useState(0);
  const [confirm, setConfirm] = useState(false); const dialog = useRef<HTMLDialogElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null); const scope = useRef(0);
  const queue = useRef(Promise.resolve()); const pending = useRef(new Map<number, string>()); const locked = useRef(false); const failed = useRef(new Set<number>());
  useEffect(() => {
    if (status !== 'signed-in') return;
    const generation = ++scope.current; const controller = new AbortController();
    setPlayer(null); setAnswers({}); setError(''); setBusy(false); locked.current = false; pending.current.clear(); failed.current.clear(); queue.current = Promise.resolve();
    void (async () => {
      if (!await whenGlobalReady(() => !!window.api?.getWith && !!window.api?.postWith && !!window.api?.patchWith, 'Black Eye API')) throw new Error();
      const initial = await window.api.getWith<Player>(`${API}/tests/${encodeURIComponent(testId)}`, undefined, { signal: controller.signal });
      if (scope.current !== generation) return;
      if (!initial.activity.selectable) throw new Error('Activity chưa sẵn sàng.');
      const query = classItem ? `class_item=${encodeURIComponent(classItem)}` : 'standalone=true';
      const attempt = await window.api.postWith<Attempt>(`${API}/tests/${encodeURIComponent(testId)}/attempts?${query}`, { blackeye_binding: initial.activity.binding }, undefined, { signal: controller.signal });
      if (scope.current !== generation) return;
      const result = await window.api.getWith<Player>(`${API}/tests/${encodeURIComponent(testId)}?attempt_id=${encodeURIComponent(attempt.attempt_id)}${classItem ? `&class_item=${encodeURIComponent(classItem)}` : ''}`, undefined, { signal: controller.signal });
      if (scope.current !== generation) return;
      setAnswers(Object.fromEntries(attempt.answers.map(a => [a.q_num, a.user_answer]))); setPlayer(result);
    })().catch(() => { if (scope.current === generation) setError('Không tải được activity. Hãy thử lại.'); });
    return () => { scope.current++; controller.abort(); };
  }, [status, user?.id, testId, classItem, retry]);
  useEffect(() => { if (confirm) dialog.current?.showModal(); else dialog.current?.close(); }, [confirm]);
  function persist(q: number, value: string) {
    const attemptId = player?.attempt?.attempt_id; if (!attemptId) return;
    const generation = scope.current;
    pending.current.set(q, value); setSave('saving');
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (generation !== scope.current) return;
      try {
        await window.api.patchWith(`${API}/tests/attempts/${encodeURIComponent(attemptId)}/answers`, { q_num: q, user_answer: value });
        if (generation !== scope.current) return;
        if (pending.current.get(q) === value) { pending.current.delete(q); failed.current.delete(q); }
        setSave(failed.current.size ? 'error' : pending.current.size ? 'saving' : 'saved');
      } catch {
        if (generation === scope.current) { failed.current.add(q); setSave('error'); }
      }
    });
  }
  function change(q: number, value: string) { if (locked.current) return; setAnswers(a => ({ ...a, [q]: value })); persist(q, value); }
  async function submit() {
    if (locked.current || !player?.attempt) return;
    locked.current = true; setBusy(true); setError(''); setConfirm(false);
    const generation = scope.current; const id = player.attempt.attempt_id;
    try {
      await queue.current;
      if (pending.current.size) throw new Error();
      let canonical: Attempt;
      try { canonical = await window.api.postWith<Attempt>(`${API}/tests/attempts/${encodeURIComponent(id)}/submit`, {}); }
      catch { canonical = await window.api.getWith<Attempt>(`${API}/tests/attempts/${encodeURIComponent(id)}`); }
      if (generation !== scope.current) return;
      if (canonical.status !== 'submitted') throw new Error();
      window.location.assign(`/listening/programmes/result/${encodeURIComponent(id)}?blackeye=1`);
    } catch { if (generation === scope.current) { setError('Chưa xác nhận đã nộp. Câu trả lời vẫn được giữ; hãy thử lại.'); setBusy(false); locked.current = false; } }
  }
  if (status === 'signed-out') return <a href="/login">Đăng nhập để làm bài</a>;
  if (!player) return <main className="programme-runner">{error ? <p role="alert">{error} <button onClick={() => setRetry(retry + 1)}>Thử lại</button></p> : <p role="status">Đang mở activity…</p>}</main>;
  const blanks = player.activity.items.filter(i => blackEyeBlank(i, answers[i.q_num]));
  return <main className="programme-runner"><h1>{player.activity.title}</h1><p>Không chấm điểm tự động</p>{player.audio.url && <audio controls src={player.audio.url} preload="none" aria-label="Audio của activity" onPlay={() => { if (player.attempt) void window.api.postWith(`${API}/tests/attempts/${encodeURIComponent(player.attempt.attempt_id)}/playback-started`, { playback_claim_id: crypto.randomUUID() }).catch(() => setError('Chưa xác nhận phát audio.')); }} />}
    <p role="status">{save === 'saving' ? 'Đang lưu…' : save === 'saved' ? 'Đã lưu' : 'Chưa lưu'}</p>{save === 'error' && <button onClick={() => Array.from(pending.current).forEach(([q, v]) => persist(q, v))}>Thử lưu lại</button>}
    {error && <p role="alert">{error}</p>}
    {player.activity.items.map(item => { let pair = { action: '', correction_text: '' }; try { if (answers[item.q_num]) pair = JSON.parse(answers[item.q_num]); } catch { /* Text cells have no composite. */ }
      const context = [item.group_id, item.row_id, item.column_id].filter(Boolean).join(' · '); const label = `Câu ${item.source_display_number}${context ? ` · ${context}` : ''}`;
      return <fieldset disabled={busy} key={item.source_item_id} className="programme-review-item" style={{ minWidth: 0 }}><legend>{label}</legend><p>{item.instruction}</p><p>{item.prompt}</p>{item.givens.map((given, i) => <p key={i}>{given}</p>)}{item.interaction === 'text' ? <label>{label}<textarea style={{ width: '100%', boxSizing: 'border-box', minHeight: 44 }} value={answers[item.q_num] || ''} maxLength={2000} onChange={e => change(item.q_num, e.target.value)} /></label> : <><label>{label} · KEEP/CHANGE<select style={{ minHeight: 44 }} value={pair.action || ''} onChange={e => change(item.q_num, JSON.stringify({ version: 'blackeye_keep_change_v1', action: e.target.value || null, correction_text: pair.correction_text || '' }))}><option value="">Chưa chọn</option><option value="KEEP">KEEP</option><option value="CHANGE">CHANGE</option></select></label><label>{label} · Chữ sửa<textarea style={{ width: '100%', boxSizing: 'border-box', minHeight: 44 }} value={pair.correction_text || ''} maxLength={1800} onChange={e => change(item.q_num, JSON.stringify({ version: 'blackeye_keep_change_v1', action: pair.action || null, correction_text: e.target.value }))} /></label></>}</fieldset>;
    })}
    <button ref={submitButton} disabled={busy} style={{ minHeight: 44 }} onClick={() => blanks.length ? setConfirm(true) : void submit()}>{busy ? 'Đang nộp…' : 'Nộp bài'}</button>
    <dialog ref={dialog} aria-labelledby="blackeye-confirm-title" onCancel={() => setConfirm(false)}><h2 id="blackeye-confirm-title">Xác nhận ô trống</h2><p>Ô chưa hoàn tất: {blanks.map(i => i.source_display_number).join(', ')}</p><button autoFocus onClick={() => { setConfirm(false); submitButton.current?.focus(); }}>Tiếp tục làm</button><button onClick={() => void submit()}>Nộp với ô trống</button></dialog>
  </main>;
}
