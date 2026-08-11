// Trang Skill Practice trên Next — `/reading/skill`.
import type { Metadata } from 'next';

import { ReadingSkillBehavior } from './reading-skill-behavior';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Skill Practice — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingSkillPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      {/* @ts-ignore */}
      <aver-chrome active="reading" />
      <ReadingSkillBehavior />
    </>
  );
}
