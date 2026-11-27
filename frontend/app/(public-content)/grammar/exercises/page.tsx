// Trang "Bài tập Grammar" trên Next — `/grammar/exercises`.
//
// Behavior đã được port sang React trong `grammar-exercises-behavior.tsx`;
// route công khai không còn inject module legacy hay phụ thuộc DOMContentLoaded.
import type { Metadata } from 'next';
import { SubpageFrame, SubpageHeader, frameStyles as styles } from '../subpage-frame';
import { GrammarExercisesBehavior } from './grammar-exercises-behavior';

export const metadata: Metadata = {
  title: 'Bài tập Grammar — Aver Learning',
  description: 'Chọn bài tập Grammar theo chủ đề và trình độ để luyện đúng điểm cần cải thiện.',
  alternates: { canonical: '/grammar/exercises' },
};

export default function GrammarExercisesPage() {
  return (
    <SubpageFrame crumbs={[{ label: 'Bài tập' }]}>
      <main id="exercises-container" tabIndex={-1} className={styles.main}>
        <SubpageHeader
          eyebrow="Grammar Wiki · Bài tập"
          title="Chọn đúng bài cần luyện"
          intro="Tìm theo chủ đề và trình độ; khi đăng nhập, trạng thái mastery thật sẽ giúp bạn ưu tiên bài phù hợp."
          introId="exercises-intro"
        />
        <GrammarExercisesBehavior />
      </main>
    </SubpageFrame>
  );
}
