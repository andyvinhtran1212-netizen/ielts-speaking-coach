import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminExerciseBookGrants } from '@/components/exercise-book/admin-exercise-book-grants';
import { ExerciseBookApiProvider } from '@/lib/exercise-book/api-context';

export const metadata: Metadata = {
  title: 'Quyền sách bài tập · Admin',
  robots: { index: false, follow: false },
};

async function AdminExerciseBookGrantsRoute({ params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params;
  return (
    <aver-admin-chrome active="classes" subsection="classes">
      <AdminAccessGate>
        <main className="acd-shell acx-shell">
          <nav className="acx-breadcrumb" aria-label="Đường dẫn"><a href={`/admin/classes/${encodeURIComponent(cohortId)}`}>Về lớp</a></nav>
          <h1>Quyền sách bài tập · course 2</h1>
          <ExerciseBookApiProvider><AdminExerciseBookGrants cohortId={cohortId} /></ExerciseBookApiProvider>
        </main>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminExerciseBookGrantsPage({ params }: { params: Promise<{ cohortId: string }> }) {
  return (
    <Suspense fallback={<main className="acd-shell"><div className="acd-state" role="status">Đang kiểm tra quyền…</div></main>}>
      <AdminExerciseBookGrantsRoute params={params} />
    </Suspense>
  );
}
