// One Kiến thức Writing guide (LIBRARY-0061 T011), split from page.tsx so
// tests can render it with fixed data.
import { CourseLinkLine } from '@/components/library/course-link-line';
import { ReadingBlock, ReadingLayout } from '@/components/library/reading-layout';
import { formatGuideDate, groupAnchor, guideGroup, guideHref, withSampleLinks } from '@/lib/writing-guides-model.mjs';

import type { GuideDetail } from '../guides-data';
import styles from '../writing-guides.module.css';

function GroupLinks({ guide }: { guide: GuideDetail }) {
  const groups = guide.groups.map((g) => guideGroup(g.id)).filter((g) => g !== null);
  if (groups.length === 0) return null;
  return (
    <p className={styles.memberOf}>
      Thuộc nhóm{' '}
      {groups.map((g, i) => (
        <span key={g.id}>
          {i > 0 ? (i === groups.length - 1 ? ' và ' : ', ') : null}
          <a href={`/library/writing-guides#${groupAnchor(g.id)}`}>
            {g.n} · {g.label}
          </a>
        </span>
      ))}
    </p>
  );
}

export function GuideArticle({ guide, sampleLive }: { guide: GuideDetail; sampleLive: boolean }) {
  const updated = formatGuideDate(guide.updated_at);
  const firstGroup = guideGroup(guide.groups[0]?.id ?? '');
  const eyebrow = ['Kiến thức Writing', ...guide.groups.map((g) => g.label)].join(' · ');
  const meta = [`Đọc khoảng ${guide.reading_minutes} phút`, updated ? `cập nhật ${updated}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <ReadingLayout
        toc={guide.toc}
        tocFooter={<GroupLinks guide={guide} />}
        header={
          <>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1 className={styles.articleTitle}>{guide.title}</h1>
            <p className={styles.meta}>{meta}</p>
          </>
        }
      >
        <ReadingBlock>
          <div
            className={styles.prose}
            data-testid="guide-body"
            // Server-rendered by the API from Markdown; raw HTML is escaped there.
            dangerouslySetInnerHTML={{ __html: withSampleLinks(guide.html, sampleLive) }}
          />
        </ReadingBlock>
        <ReadingBlock>
          <CourseLinkLine href="/" linkLabel="Xem các khoá học">
            Đọc ở đây là miễn phí. Muốn nộp bài để được chấm theo bốn tiêu chí, có trích đúng câu trong bài, cần một
            khoá học.
          </CourseLinkLine>
          {guide.prev || guide.next ? (
            <nav aria-label="Bài trong cùng nhóm" className={styles.pager}>
              {guide.prev ? (
                <a href={guideHref(guide.prev.slug)} rel="prev">
                  <span className={styles.pagerLabel}>‹ Bài trước{firstGroup ? ` trong nhóm ${firstGroup.label}` : ''}</span>
                  <span className={styles.pagerTitle}>{guide.prev.title}</span>
                </a>
              ) : null}
              {guide.next ? (
                <a href={guideHref(guide.next.slug)} rel="next" className={styles.pagerNext}>
                  <span className={styles.pagerLabel}>Bài sau{firstGroup ? ` trong nhóm ${firstGroup.label}` : ''} ›</span>
                  <span className={styles.pagerTitle}>{guide.next.title}</span>
                </a>
              ) : null}
            </nav>
          ) : null}
          <p className={styles.source}>
            Nguồn: Aver Learning biên soạn.{updated ? ` Cập nhật ${updated}.` : ''}
          </p>
        </ReadingBlock>
      </ReadingLayout>
    </>
  );
}

/** A guide the API does not have (unknown, unpublished or withdrawn). */
export function GuideMissing() {
  return (
    <div data-testid="guide-missing">
      <p className={styles.eyebrow}>Không tìm thấy</p>
      <h1 className={styles.articleTitle}>Không có bài kiến thức này</h1>
      <p>Bài có thể đã đổi địa chỉ hoặc không còn trong Thư viện.</p>
      <p>
        <a href="/library/writing-guides">Xem tất cả bài Kiến thức Writing</a>
      </p>
    </div>
  );
}
