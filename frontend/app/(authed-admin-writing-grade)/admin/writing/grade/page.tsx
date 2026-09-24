import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminWritingGradeBehavior, AdminWritingGradeLoading } from './writing-grade-behavior';

export const metadata: Metadata = {
  title: 'Review + Edit — Writing Coach Admin',
  robots: { index: false, follow: false },
};

async function AdminWritingGradeBody({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const embed = params.embed === '1';
  return (
    <aver-admin-chrome active="writing" subsection="queue" embed={embed ? '' : undefined}>
      <AdminAccessGate>
        <Suspense fallback={<AdminWritingGradeLoading />}>
          <AdminWritingGradeBehavior />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminWritingGradePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Suspense fallback={<AdminWritingGradeLoading />}><AdminWritingGradeBody searchParams={searchParams} /></Suspense>;
}
