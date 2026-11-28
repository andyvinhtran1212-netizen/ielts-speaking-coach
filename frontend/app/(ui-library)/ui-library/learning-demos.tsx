'use client';

// /ui-library interactive demos for G03-T09: a palette whose cells move the
// current question, and an annotated essay whose margin numbers select a note.
// Sample data only.
import { useState } from 'react';

import { AnnotatedText, QuestionPalette, type AnnotatedSegment, type QuestionItem } from '@/components/ui';

const ANSWERED = new Set([1, 2, 3, 4, 6, 7, 8, 10, 11, 12]);
const FLAGGED = new Set([3, 9]);

export function PaletteDemo({ lang }: { lang: 'en' | 'vi' }) {
  const [current, setCurrent] = useState(5);
  const items: QuestionItem[] = Array.from({ length: 13 }, (_, i) => {
    const num = i + 1;
    return { num, state: ANSWERED.has(num) ? 'answered' : 'unanswered', flagged: FLAGGED.has(num), current: num === current };
  });
  return (
    <QuestionPalette
      lang={lang}
      title={lang === 'en' ? 'Part 1 · Questions 1–13' : 'Câu 1–13'}
      items={items}
      onSelect={setCurrent}
    />
  );
}

const ESSAY: AnnotatedSegment[] = [
  { text: 'Many cities are spending more money on public transport, and some people argue that this is the best way to reduce traffic. I ' },
  { text: 'am agree', mark: 1, note: 1 },
  { text: ' with this view to some extent. Firstly, buses and trains can carry many passengers at once. ' },
  { text: 'For instance, one train on a new metro line can replace hundreds of motorbikes during rush hour.', mark: 4, note: 2 },
  { text: ' However, if tickets are ' },
  { text: 'expensive price', mark: 2, note: 3 },
  { text: ', many people will still prefer their own vehicles. ' },
  { text: 'Secondly, the government should build more parks in the suburbs.', mark: 3, note: 4 },
];

const NOTES = [
  { number: 1, label: 'Ngữ pháp · đoạn 1', body: 'agree đã là động từ, bỏ am: I agree with this view.' },
  { number: 2, label: 'Làm tốt · đoạn 2', body: 'Ví dụ cụ thể, có số lượng, đỡ cho ý vừa nêu.' },
  { number: 3, label: 'Từ vựng · đoạn 2', body: '“price” đã nằm trong “expensive”. Viết: if tickets are expensive.' },
  { number: 4, label: 'Mạch lạc · đoạn 3', body: 'Câu chủ đề lạc khỏi đề giao thông. Nối về ý chính hoặc bỏ.' },
];

export function AnnotatedDemo() {
  const [selected, setSelected] = useState(3);
  return <AnnotatedText segments={ESSAY} notes={NOTES} selected={selected} onSelect={setSelected} />;
}
