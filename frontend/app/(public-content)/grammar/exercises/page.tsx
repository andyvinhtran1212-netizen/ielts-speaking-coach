// Trang "Bài tập Grammar" trên Next — `/grammar/exercises`.
//
// Behavior đã được port sang React trong `grammar-exercises-behavior.tsx`;
// route công khai không còn inject module legacy hay phụ thuộc DOMContentLoaded.
import type { Metadata } from 'next';

import { GrammarExercisesBehavior } from './grammar-exercises-behavior';

export const metadata: Metadata = {
  title: 'Bài tập Grammar — Aver Learning',
};

export default function GrammarExercisesPage() {
  return (
    <>
      {/* @ts-ignore — Aver chrome là Web Component dùng chung với legacy. */}
      <aver-chrome active="grammar" />

      <main className="av-w-page py-8">
        <header className="mb-8">
          <nav className="text-sm text-white/40 mb-3">
            <a href="/grammar" className="hover:text-white/70">Grammar Wiki</a>{' '}
            <span className="mx-1">/</span>{' '}
            <span className="text-white/60">Bài tập</span>
          </nav>
          <h1 className="text-3xl font-extrabold text-white mb-2">Bài tập Grammar</h1>
          <p className="text-white/45">
            Kiểm tra kiến thức ngữ pháp theo từng bài — làm tới khi thành thạo.
          </p>
        </header>

        <GrammarExercisesBehavior />
      </main>
    </>
  );
}
