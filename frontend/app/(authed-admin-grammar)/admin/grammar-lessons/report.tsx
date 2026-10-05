'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ApiGetJson } from '@/lib/openapi-contract';
import { useAuth } from '@/lib/auth/auth-provider';

type Report = ApiGetJson<'/admin/grammar-lessons/attempts/{attempt_id}'>;

export function GrammarLessonReport() {
  const { status: authStatus, user } = useAuth();
  const attempt = useSearchParams()?.get('attempt') || '';
  const contextKey = user?.id ? `${user.id}:${attempt}` : '';
  const [loaded, setLoaded] = useState<{ key: string; value: Report } | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const report = loaded?.key === contextKey ? loaded.value : null;
  useEffect(() => {
    let active = true;
    setLoaded(null); setError('');
    if (authStatus !== 'signed-in' || !contextKey) return () => { active = false; };
    if (!attempt) { setError('Thiếu mã lượt làm Grammar.'); return; }
    void (async () => {
      try {
        const value = await window.api.get<Report>(`/admin/grammar-lessons/attempts/${encodeURIComponent(attempt)}`);
        if (active) setLoaded({ key: contextKey, value });
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => { active = false; };
  }, [attempt, authStatus, contextKey, reload]);
  if (authStatus === 'signed-out') return <main className="agl-shell"><p>Đăng nhập để xem báo cáo Grammar.</p><a href="/login">Đăng nhập</a></main>;
  if (error) return <main className="agl-shell"><div className="agl-alert" role="alert">{error}</div><button type="button" onClick={() => setReload((value) => value + 1)}>Thử lại</button></main>;
  if (!report) return <main className="agl-shell" role="status">Đang tải báo cáo…</main>;
  return <main className="agl-shell"><a className="agl-back" href="/admin/classes">← Danh sách lớp</a>
    <header className="agl-hero"><p>COURSE 5 · EDUCATOR VIEW</p><h1>{report.lesson_id} · {report.assignment_title}</h1><p>{report.focus}</p><div className="agl-meta"><span>{report.status === 'completed' ? 'Đã hoàn thành' : 'Đang làm'}</span><span>{report.correct_count}/{report.question_count} câu đúng</span></div></header>
    <section className="agl-card"><h2>Chi tiết từng câu</h2><p>Những câu chưa làm chưa có đáp án của học viên.</p><div className="agl-questions">{report.questions.map((question, index) => <article className="agl-question" key={question.id}><h3>Câu {index + 1}</h3><p>{question.prompt}</p>{question.selected_index == null ? <p>Chưa trả lời</p> : <><p><strong>Học viên chọn:</strong> {question.options[question.selected_index]}</p><p><strong>Đáp án:</strong> {question.correct_index == null ? '—' : question.options[question.correct_index]}</p><div className={`agl-feedback ${question.is_correct ? 'is-correct' : 'is-incorrect'}`}><strong>{question.is_correct ? 'Đúng' : 'Cần sửa'}</strong><p>{question.explanation}</p></div></>}</article>)}</div></section>
  </main>;
}
