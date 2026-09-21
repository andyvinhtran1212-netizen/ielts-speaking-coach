import type { Metadata } from 'next';

import { ListeningProgrammeLibrary } from '../programme-library';

export const metadata: Metadata = { title: 'IELTS Listening Practice — Aver Learning', robots: { index: false, follow: false } };

export default function IeltsListeningProgrammePage() {
  return <><aver-chrome active="listening" /><ListeningProgrammeLibrary programmeId="ielts-listening-practice" title="IELTS Listening Practice" description="Bài luyện IELTS report-only để nghe, trả lời và tự đối chiếu. Thư viện này tách biệt với Full Test có chấm điểm và band ước tính." showIeltsModes /></>;
}
