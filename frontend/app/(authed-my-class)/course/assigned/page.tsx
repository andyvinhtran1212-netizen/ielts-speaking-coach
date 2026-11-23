import type { Metadata } from 'next';

import { AssignedTreeSwitch } from './assigned-tree-switch';
import { MyClassWorkspace } from './my-class-workspace';

export const metadata: Metadata = {
  title: 'Lớp học · Aver Learning',
  robots: { index: false, follow: false },
};

export default function MyClassPage() {
  return (
    <>
      {/* @ts-ignore -- aver-chrome is the coexistence Web Component. */}
      <aver-chrome active="class" />
      {/* LEARNERCORE-0063 FR-095: the legacy tree unchanged unless learner_v2 is on. */}
      <AssignedTreeSwitch>
        <MyClassWorkspace />
      </AssignedTreeSwitch>
    </>
  );
}
