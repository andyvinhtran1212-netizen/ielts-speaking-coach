'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { PageState, Select, TextField } from '@/components/ui';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import { categoryLabel, levelLabel, frameStyles as styles } from '../subpage-frame';

interface GrammarExerciseBank {
  id: string; code?: string | null; title?: string | null; words_count?: number | null;
  slug?: string | null; category?: string | null; level?: string | null; summary?: string | null;
}
interface GrammarExercisesPayload { banks?: GrammarExerciseBank[] }
interface MasteryPayload { items?: Array<{ ref_slug?: string; status?: string }> }

const LEVEL_OPTIONS = [
  { value: '', label: 'Tất cả' },
  { value: 'beginner', label: 'Cơ bản' },
  { value: 'intermediate', label: 'Trung cấp' },
  { value: 'advanced', label: 'Nâng cao' },
];

/** Mastery word + tone of the tag (the word carries the meaning, not the colour). */
const MASTERY: Record<string, { label: string; tone: string }> = {
  weak: { label: 'Cần luyện', tone: 'danger' },
  strong: { label: 'Đã vững', tone: 'ok' },
  learning: { label: 'Đang học', tone: 'mark' },
};

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

  if (error) return <div role="alert"><PageState kind="error" title={error} /></div>;
  if (banks == null) return <p role="status" className={styles.empty}>Đang tải bài tập…</p>;
  if (!banks.length) return <PageState kind="empty" title="Chưa có bài tập nào được mở. Vui lòng quay lại sau." />;

  const categoryOptions = [{ value: '', label: 'Tất cả' }, ...categories.map((item) => ({ value: item, label: categoryLabel(item) }))];
  return <div>
    <div className={styles.filters} role="search" aria-label="Lọc bài tập">
      <TextField label="Tìm bài luyện" value={query} onChange={(value) => setQuery(value)} placeholder="Articles, tenses, sentence…" className={styles.filterWide} />
      <Select label="Chủ đề" value={category} onChange={(value) => setCategory(value)} options={categoryOptions} className={styles.filterField} />
      <Select label="Trình độ" value={level} onChange={(value) => setLevel(value)} options={LEVEL_OPTIONS} className={styles.filterField} />
    </div>
    <p className={styles.count} aria-live="polite"><strong>{visible.length}</strong> bài luyện phù hợp. Mỗi bank vẫn là nguồn canonical cho câu hỏi và đáp án.</p>
    {visible.length ? <ul className={styles.list}>{visible.map((bank) => {
      const mastery = bank.slug ? MASTERY[statusOf(bank.slug)] : undefined;
      return <li key={bank.id} className={styles.item}>
        <h2 className={styles.itemTitle}>
          <Link href={`/quiz?bank=${encodeURIComponent(bank.id)}`}>{bank.title || bank.code}</Link>
          {mastery ? <span className={styles.tag} data-tone={mastery.tone}>{mastery.label}</span> : null}
        </h2>
        <p className={styles.itemMeta}>{[categoryLabel(bank.category || 'Grammar'), levelLabel(bank.level) || 'Nhiều trình độ', bank.words_count ? `${bank.words_count} điểm` : null].filter(Boolean).join(' · ')}</p>
        <p className={styles.itemText}>{bank.summary || 'Luyện đúng trọng tâm của bài Grammar Wiki này.'}</p>
      </li>;
    })}</ul> : <PageState kind="empty" title="Không có bài luyện khớp bộ lọc. Hãy thử phạm vi rộng hơn." />}
  </div>;

  function statusOf(slug: string) {
    const status = mastery[slug];
    return status ? (status === 'weak' || status === 'strong' ? status : 'learning') : '';
  }
}
