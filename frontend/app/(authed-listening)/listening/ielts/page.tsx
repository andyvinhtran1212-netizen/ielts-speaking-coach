import type { Metadata } from 'next';

import { ListeningProgrammeLibrary } from '../programme-library';

export const metadata: Metadata = { title: 'IELTS Listening Practice — Aver Learning', robots: { index: false, follow: false } };

export default function IeltsListeningProgrammePage() {
  return <><aver-chrome active="listening" /><ListeningProgrammeLibrary programmeId="ielts-listening-practice" title="IELTS Listening Practice" description="Nghe, trả lời và đối chiếu từng câu. Đây là bài luyện tập, không tính band IELTS; Full Test nằm ở khu vực riêng." showIeltsModes /></>;
}
