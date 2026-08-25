'use client';

import { useEffect, useMemo, useState } from 'react';

import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface GrammarExerciseBank {
  id: string; code?: string | null; title?: string | null; words_count?: number | null;
  slug?: string | null; category?: string | null; level?: string | null; summary?: string | null;
}
interface GrammarExercisesPayload { banks?: GrammarExerciseBank[] }
interface MasteryPayload { items?: Array<{ ref_slug?: string; status?: string }> }

const prettify = (value: string) => value.replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());

export function GrammarExercisesBehavior() {
  const [banks, setBanks] = useState<GrammarExerciseBank[] | null>(null);
  const [mastery, setMastery] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');

  useEffect(() => {
    const controller = new AbortController(); let disposed = false;
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (grammar exercises)');
      if (!ready) throw new Error('API chưa sẵn sàng');
      const payload = await window.api.getWith<GrammarExercisesPayload>('/api/grammar/exercises', undefined, { signal: controller.signal });
      if (!disposed) setBanks(Array.isArray(payload?.banks) ? payload.banks : []);
      const sb = (window as any).getSupabase?.();
      const session = await sb?.auth.getSession();
      if (!session?.data?.session || disposed) return;
      const data = await window.api.getWith<MasteryPayload>('/api/me/kp-mastery?kp_type=grammar', undefined, { signal: controller.signal });
      if (!disposed) setMastery(Object.fromEntries((data?.items || []).filter((item) => item.ref_slug).map((item) => [item.ref_slug!, item.status || 'learning'])));
    })().catch((caught: any) => { if (caught?.name !== 'AbortError' && !disposed) setError('Không tải được bài tập. Vui lòng tải lại trang.'); });
    return () => { disposed = true; controller.abort(); };
  }, []);

  const categories = useMemo(() => [...new Set((banks || []).map((bank) => bank.category).filter(Boolean) as string[])].sort(), [banks]);
  const visible = useMemo(() => (banks || []).filter((bank) => {
    const haystack = `${bank.title || ''} ${bank.summary || ''}`.toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (!category || bank.category === category) && (!level || bank.level === level);
  }), [banks, query, category, level]);

  if (error) return <div className="gw-state-card">{error}</div>;
  if (banks == null) return <div className="skeleton h-64 rounded-2xl" aria-label="Đang tải bài tập">Đang tải bài tập…</div>;
  if (!banks.length) return <div className="gw-state-card">Chưa có bài tập nào được mở. Vui lòng quay lại sau.</div>;

  return <div className="gw-exercise-workspace">
    <div className="gw-exercise-filters">
      <label className="gw-filter-search">Tìm bài luyện<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Articles, tenses, sentence…" /></label>
      <label>Chủ đề<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Tất cả</option>{categories.map((item) => <option key={item} value={item}>{prettify(item)}</option>)}</select></label>
      <label>Trình độ<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="">Tất cả</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
    </div>
    <div className="gw-exercise-summary"><strong>{visible.length}</strong><span>bài luyện phù hợp</span><p>Mỗi bank vẫn là nguồn canonical cho câu hỏi và đáp án.</p></div>
    {visible.length ? <div className="gw-exercise-grid">{visible.map((bank) => {
      const status = bank.slug ? mastery[bank.slug] : '';
      return <a key={bank.id} href={`/pages/quiz.html?bank=${encodeURIComponent(bank.id)}`} className="gw-exercise-card">
        <div className="gw-exercise-card-top"><span>{prettify(bank.category || 'Grammar')}</span>{status && <small className={`is-${status}`}>{status === 'weak' ? 'Cần luyện' : status === 'strong' ? 'Đã vững' : 'Đang học'}</small>}</div>
        <h2>{bank.title || bank.code}</h2><p>{bank.summary || 'Luyện đúng trọng tâm của bài Grammar Wiki này.'}</p>
        <div><span>{bank.level || 'mixed level'}</span><strong>{bank.words_count ? `${bank.words_count} điểm` : 'Bắt đầu'} →</strong></div>
      </a>;
    })}</div> : <div className="gw-state-card">Không có bài luyện khớp bộ lọc. Hãy thử phạm vi rộng hơn.</div>}
  </div>;
}
