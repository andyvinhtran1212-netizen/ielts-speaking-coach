// Parts of the Kiến thức Writing list (LIBRARY-0061 T011), split from
// page.tsx so tests can render them with fixed data.
import { formatShelfNumber } from '@/lib/library-shelves.mjs';
import { GUIDE_GROUPS, groupAnchor, guideHref, visibleGroups } from '@/lib/writing-guides-model.mjs';

import type { GuideList } from './guides-data';
import styles from './writing-guides.module.css';

export function Intro({ total }: { total: number | null }) {
  const count = formatShelfNumber(total);
  return (
    <p className={styles.lead}>
      {count ? `${count} bài giải thích` : 'Các bài giải thích'} cách viết Task 1 và Task 2, cách người chấm đọc bài theo
      bốn tiêu chí, và cách làm từng dạng đề.
    </p>
  );
}

export function GuideGroups({ data }: { data: GuideList }) {
  const groups = visibleGroups(data.groups);
  if (groups.length === 0) {
    return (
      <p className={styles.notice} data-testid="guides-empty">
        Chưa có bài kiến thức nào. Trong lúc chờ, bạn có thể đọc bài mẫu Writing hoặc ngữ pháp trong Thư viện.{' '}
        <a href="/library">Về Thư viện</a>
      </p>
    );
  }
  return (
    <>
      <nav aria-label="Các nhóm bài" className={styles.groupNav}>
        {groups.map((g) => (
          <a key={g.id} href={`#${groupAnchor(g.id)}`}>
            <span className={styles.num}>{g.n}</span>
            {g.label}
          </a>
        ))}
      </nav>
      {groups.map((g) => (
        <section
          key={g.id}
          id={groupAnchor(g.id)}
          aria-labelledby={`${groupAnchor(g.id)}-title`}
          className={styles.group}
          data-group={g.id}
        >
          <div>
            <h2 id={`${groupAnchor(g.id)}-title`} className={styles.groupTitle}>
              <span className={styles.num}>{g.n}</span> {g.label}
            </h2>
            <p className={styles.groupNote}>{g.note}</p>
          </div>
          <ol className={styles.rows}>
            {g.items.map((item) => (
              <li key={item.slug} className={styles.row}>
                <span className={styles.rowMain}>
                  <a href={guideHref(item.slug)} className={styles.rowTitle}>
                    {item.title}
                  </a>
                  {item.summary ? <span className={styles.rowSummary}>{item.summary}</span> : null}
                </span>
                <span className={styles.rowMeta}>{item.reading_minutes} phút đọc</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

export function GuidesError({
  reloadHref = '/library/writing-guides',
  what = 'danh sách bài kiến thức',
}: {
  reloadHref?: string;
  what?: string;
}) {
  return (
    <div className={styles.notice} role="alert" data-testid="guides-error">
      <p>Chưa tải được {what}. Kiểm tra mạng rồi tải lại trang.</p>
      <a href={reloadHref} className={styles.reload}>
        Tải lại
      </a>
    </div>
  );
}

export function GuidesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Đang tải danh sách bài" data-testid="guides-skeleton">
      {GUIDE_GROUPS.map((g) => (
        <div key={g.id} className={styles.group}>
          <div>
            <p className={styles.groupTitle}>
              <span className={styles.num}>{g.n}</span> {g.label}
            </p>
          </div>
          <ol className={styles.rows}>
            {[0, 1, 2].map((i) => (
              <li key={i} className={styles.row}>
                <span className={styles.placeholder} />
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
