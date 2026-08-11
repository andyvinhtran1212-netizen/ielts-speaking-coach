import type { Metadata } from 'next';

import { ListeningTestSession } from './listening-test-session';

export const metadata: Metadata = {
  title: 'Listening Test — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningTestSessionPage() {
  return <ListeningTestSession />;
}
