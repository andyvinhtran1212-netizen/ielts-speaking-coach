'use client';

// "Cần có khoá" (LEARNERCORE-0063 FR-092, G07-T26). Shown by AuthProvider in
// place of a learner page when an inactive account with learner_v2 opens a
// page outside INACTIVE_OPEN_PATHS. The page itself never mounts, so none of
// its API calls (and none of their 403s) happen. No sign-out.
//
// Links: "Xem các khoá" only once the courses page is live (`coursesHref`,
// hidden otherwise, as when the commerce flag is off); "Nhập mã kích hoạt"
// goes to /activate when that route is live, otherwise to /login, whose
// /auth/me routing opens the access-code dialog for an inactive account;
// plus the way back to Hôm nay.
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import { Button } from '@/components/ui/button';
import { PageState } from '@/components/ui/page-state';
import { isLiveRoute } from '@/components/ui/shell/learner-sections';

import styles from './needs-course-screen.module.css';

/** The public course list, once G04/G05 make it live; null hides the link. */
export function coursesHref(): string | null {
  return isLiveRoute('/courses') ? '/courses' : null;
}

export function activationHref(): string {
  return isLiveRoute('/activate') ? '/activate' : '/login';
}

export function NeedsCourseScreen() {
  const courses = coursesHref();
  return (
    <div className={`av2-root ${styles.page}`} data-needs-course="">
      <main className={styles.main}>
        <PageState
          kind="locked"
          title="Cần có khoá"
          body="Trang này dành cho học viên đã có khoá học. Bạn vẫn xem được Hôm nay, Tài khoản, Hồ sơ và Trợ giúp."
          action={(
            <div className={styles.actions}>
              {courses ? <Button href={courses} variant="primary" size="sm">Xem các khoá</Button> : null}
              <Button href={activationHref()} variant={courses ? 'secondary' : 'primary'} size="sm">
                Nhập mã kích hoạt
              </Button>
              <Button href="/home" variant="text" size="sm">Về Hôm nay</Button>
            </div>
          )}
        />
      </main>
    </div>
  );
}

export default NeedsCourseScreen;
