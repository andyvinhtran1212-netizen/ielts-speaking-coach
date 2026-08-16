import type { Metadata } from 'next';

import { ListeningStandaloneDictation } from './listening-standalone-dictation';

export const metadata: Metadata = {
  title: 'Chép chính tả — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningStandaloneDictationPage() {
  return <><aver-chrome active="listening" /><ListeningStandaloneDictation /></>;
}
