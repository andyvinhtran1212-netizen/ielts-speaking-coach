// CSS RIÊNG của trang nhả ở ĐÂY chứ không ở layout: bốn trang trong nhóm định
// nghĩa lại cùng những selector, nạp chung thì tệp cuối thắng. Nó đứng SAU
// `listening.css` của layout — đúng thứ tự bản legacy.
import type { Metadata } from 'next';

import { ListeningSkillsBehavior } from './listening-skills-behavior';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Listening — Luyện kĩ năng — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningSkillsPage() {
  return (
    <>
      <link rel="stylesheet" href="/css/listening-skills.css" />
      {/* @ts-ignore */}
      <aver-chrome active="listening" />
      <ListeningSkillsBehavior />
    </>
  );
}
