'use client';

import { useEffect, useState } from 'react';

import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface GrammarExerciseBank {
  id: string;
  code?: string | null;
  title?: string | null;
  words_count?: number | null;
}

interface GrammarExercisesPayload {
  banks?: GrammarExerciseBank[];
}

const CATEGORIES = [
  'foundations',
  'parts-of-speech',
  'modifiers',
  'sentence-structures',
  'tenses',
  'verb-patterns',
  'grammar-for-meaning',
  'ielts-grammar-lab',
  'grammar-for-writing',
  'error-clinic',
] as const;

function prettify(value: string) {
  return value.replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function categoryOf(code?: string | null) {
  // code = G-<category>-<slug>; category có thể chứa dấu gạch nối nên phải
  // thử tên dài nhất trước, đúng như implementation legacy.
  const sorted = [...CATEGORIES].sort((a, b) => b.length - a.length);
  return sorted.find((category) => code?.startsWith(`G-${category}-`)) || 'other';
}

function groupBanks(banks: GrammarExerciseBank[]) {
  const grouped = new Map<string, GrammarExerciseBank[]>();
  for (const bank of banks) {
    const category = categoryOf(bank.code);
    grouped.set(category, [...(grouped.get(category) || []), bank]);
  }
  return [...CATEGORIES, 'other']
    .filter((category) => grouped.has(category))
    .map((category) => ({ category, banks: grouped.get(category) || [] }));
}

export function GrammarExercisesBehavior() {
  const [banks, setBanks] = useState<GrammarExerciseBank[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (grammar exercises)',
      );
      if (!ready || disposed) {
        if (!disposed) setError('Không tải được bài tập. Vui lòng tải lại trang.');
        return;
      }

      try {
        const payload = await window.api.getWith<GrammarExercisesPayload>(
          '/api/grammar/exercises',
          undefined,
          { signal: controller.signal },
        );
        if (!disposed) setBanks(Array.isArray(payload?.banks) ? payload.banks : []);
      } catch (caught: any) {
        if (caught?.name !== 'AbortError' && !disposed) {
          setError(`Không tải được bài tập: ${caught?.message || String(caught)}`);
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, []);

  if (error) return <div className="text-white/40 py-12 text-center">{error}</div>;
  if (banks == null) {
    return <div className="text-white/40 py-12 text-center">Đang tải bài tập…</div>;
  }
  if (!banks.length) {
    return (
      <div className="text-white/40 py-12 text-center">
        Chưa có bài tập nào được mở. Vui lòng quay lại sau.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {groupBanks(banks).map((group) => (
        <section key={group.category}>
          <h2 className="text-lg font-bold text-white mb-3">{prettify(group.category)}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.banks.map((bank) => (
              <a
                key={bank.id}
                href={`/pages/quiz.html?bank=${encodeURIComponent(bank.id)}`}
                className="group flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 transition hover:border-teal/40 hover:bg-teal/[0.06]"
              >
                <span className="text-white/85 font-medium truncate">
                  {bank.title || bank.code}
                </span>
                <span className="text-xs text-white/40 whitespace-nowrap group-hover:text-teal-light">
                  {bank.words_count ? `${bank.words_count} điểm` : 'bài tập'} →
                </span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
