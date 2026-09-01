import type { Metadata } from 'next';

import { VocabCuratedHome } from './vocab-curated-home';

export const metadata: Metadata = {
  title: 'Vocab Curated — Học từ có chủ đích',
  robots: { index: false, follow: false },
};

export default function VocabCuratedPage() {
  return (
    <>
      {/* @ts-ignore custom element được đăng ký bởi AuthedShell. */}
      <aver-chrome active="vocabulary" />
      <main className="vc-shell">
        <header className="vc-topbar">
          <a href="/vocabulary/hub">← Vocabulary</a>
          <a href="/vocabulary">Reference Wiki</a>
        </header>
        <section className="vc-hero" aria-labelledby="vc-title">
          <p className="vc-eyebrow">Vocab Curated</p>
          <h1 id="vc-title">Học ít hơn. <span>Dùng được nhiều hơn.</span></h1>
          <p>Mỗi learning unit giải quyết một nghĩa, một cấu trúc và một tình huống nói cụ thể — đặc biệt nhắm vào lỗi hay gặp của học viên Việt Nam.</p>
        </section>
        <VocabCuratedHome />
      </main>
    </>
  );
}
