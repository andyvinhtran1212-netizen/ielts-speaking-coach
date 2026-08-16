import type { Metadata } from 'next';

import { ListeningStandaloneWorkspace } from '../_components/listening-standalone-workspace';

export const metadata: Metadata = {
  title: 'Nghe ý chính — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningGistPage() {
  return <><aver-chrome active="listening" /><ListeningStandaloneWorkspace mode="gist" /></>;
}
