import type { Metadata } from 'next';

import { ListeningStandaloneWorkspace } from '../_components/listening-standalone-workspace';

export const metadata: Metadata = {
  title: 'Đúng / Sai — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningTrueFalsePage() {
  return <><aver-chrome active="listening" /><ListeningStandaloneWorkspace mode="true_false" /></>;
}
