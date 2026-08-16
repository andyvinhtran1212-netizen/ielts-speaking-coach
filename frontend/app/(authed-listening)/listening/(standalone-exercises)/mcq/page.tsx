import type { Metadata } from 'next';

import { ListeningStandaloneWorkspace } from '../_components/listening-standalone-workspace';

export const metadata: Metadata = {
  title: 'Trắc nghiệm — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningMcqPage() {
  return <><aver-chrome active="listening" /><ListeningStandaloneWorkspace mode="mcq" /></>;
}
