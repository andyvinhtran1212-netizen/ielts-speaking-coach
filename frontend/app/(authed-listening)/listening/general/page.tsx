import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ListeningProgrammeLibrary } from '../programme-library';

export const metadata: Metadata = { title: 'General Listening — Aver Learning', robots: { index: false, follow: false } };

export default function GeneralListeningPage() {
  return <><aver-chrome active="listening" /><Suspense fallback={<div role="status">Đang tải thư viện…</div>}><ListeningProgrammeLibrary programmeId="general-listening-practice" title="General Listening" description="Các bài học theo tình huống và mục tiêu nghe cụ thể. Kết quả dùng để tự đối chiếu, không quy đổi CEFR hay mức độ thành thạo." /></Suspense></>;
}
