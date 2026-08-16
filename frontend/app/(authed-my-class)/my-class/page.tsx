import type { Metadata } from 'next';

import { MyClassWorkspace } from './my-class-workspace';

export const metadata: Metadata = {
  title: 'My Class · Aver Learning',
  robots: { index: false, follow: false },
};

export default function MyClassPage() {
  return (
    <>
      {/* @ts-ignore -- aver-chrome is the coexistence Web Component. */}
      <aver-chrome active="class" />
      <MyClassWorkspace />
    </>
  );
}
