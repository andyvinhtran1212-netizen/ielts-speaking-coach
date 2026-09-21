import type { Metadata } from 'next';

import { ListeningProgrammeLibrary } from '../programme-library';

export const metadata: Metadata = { title: 'General Listening — Aver Learning', robots: { index: false, follow: false } };

export default function GeneralListeningPage() {
  return <><aver-chrome active="listening" /><ListeningProgrammeLibrary programmeId="general-listening-practice" title="General Listening" description="56 bài học theo tình huống và mục tiêu nghe cụ thể. Kết quả dùng để tự đối chiếu, không quy đổi CEFR hay mức độ thành thạo." /></>;
}
