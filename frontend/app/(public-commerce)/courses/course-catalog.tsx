'use client';

// PUBLICSITE-0059 T04 — the catalogue body of `/courses`.
//
// Data truth: the server passes the guest catalogue; a signed-in visitor's own
// `viewer` states come from one browser read with the session (never cached).
// That read is tied to the account: sign-in, sign-out and A → B start over,
// and an answer for an earlier viewer is dropped. When it fails the page says
// so and keeps the guest rows; it never guesses a personal state.
//
// Every field that is null is left out (FR-004: no "0", "XXX" or empty box);
// course names come from the data only (FR-028).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OpenAlertToggle } from '@/components/courses/open-alert-toggle';
import { Button, ChoiceGroup, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-provider';
import { fetchCatalogForViewer } from '@/lib/commerce-client';
import { catalogCounts, courseRowLabel, courseRowState, formatVnd } from '@/lib/commerce-model.mjs';
import type { CourseItem } from '@/lib/commerce-types';
import { COURSE_ACCESS_ACTIONS, accessActionLabel } from '@/lib/course-access-labels.mjs';
import { coursesHref } from '@/lib/public-commerce.mjs';

import styles from './courses.module.css';

/** Where "Vào học" goes until G07's course hub `/course` is live. */
const LEARN_HREF = '/home';
const ACTIVATE_PATH = '/activate';

type ViewerRead =
  | { accountId: string; status: 'loading' | 'error' }
  | { accountId: string; status: 'ready'; items: CourseItem[] };
type RowState = ReturnType<typeof courseRowState>;

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(`${iso.slice(0, 10)}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
}

function courseHref(slug: string): string {
  return coursesHref(slug) ?? '/';
}

function levelText(item: CourseItem): string | null {
  if (item.level_from && item.level_to) return `${item.level_from} → ${item.level_to}`;
  return item.level_from ?? item.level_to ?? null;
}

function facts(item: CourseItem): string[] {
  const out: string[] = [];
  if (typeof item.lesson_count === 'number' && item.lesson_count > 0) out.push(`${item.lesson_count} bài học`);
  if (typeof item.access_days === 'number' && item.access_days > 0) out.push(`Truy cập ${item.access_days} ngày`);
  if (item.ai_credits > 0) out.push(`${item.ai_credits} lượt chấm AI`);
  return out;
}

/** The learning row with the latest expiry gets the one primary "Vào học" (FR-005). */
function primaryLearningSlug(items: CourseItem[]): string | null {
  let best: CourseItem | null = null;
  for (const item of items) {
    if (courseRowState(item) !== 'learning') continue;
    const days = item.viewer?.days_left ?? -Infinity;
    if (!best || days > (best.viewer?.days_left ?? -Infinity)) best = item;
  }
  return best?.slug ?? null;
}

function StateBadge({ item }: { item: CourseItem }) {
  const state = courseRowState(item);
  return <span className={styles.badge} data-state={state}>{courseRowLabel(item)}</span>;
}

function RowActions({ item, state, primary }: { item: CourseItem; state: RowState; primary: boolean }) {
  const view = (
    <a className={styles.viewLink} href={courseHref(item.slug)}>
      Xem khoá <span aria-hidden="true">›</span>
    </a>
  );
  if (state === 'learning') {
    return (
      <div className={styles.actions}>
        <Button href={LEARN_HREF} variant={primary ? 'primary' : 'secondary'}>{COURSE_ACCESS_ACTIONS.continue}</Button>
        {view}
      </div>
    );
  }
  if (state === 'expired') {
    return (
      <div className={styles.actions}>
        <Button href={courseHref(item.slug)} variant="secondary">{accessActionLabel('expired')}</Button>
      </div>
    );
  }
  if (state === 'upcoming') {
    return (
      <div className={styles.actions}>
        {view}
        <div className={styles.alert}><OpenAlertToggle slug={item.slug} /></div>
      </div>
    );
  }
  return <div className={styles.actions}>{view}</div>;
}

function CourseRow({ item, primary }: { item: CourseItem; primary: boolean }) {
  const state = courseRowState(item);
  const level = levelText(item);
  const list = facts(item);
  const opensOn = state === 'upcoming' ? formatDate(item.expected_open_on) : null;
  const fee = state === 'open' ? formatVnd(item.tuition_vnd) : null;
  return (
    <li className={styles.row} data-row-state={state}>
      <div className={styles.rowMain}>
        <StateBadge item={item} />
        <h3 className={styles.rowTitle}><a href={courseHref(item.slug)}>{item.title}</a></h3>
        {item.summary ? <p className={styles.summary}>{item.summary}</p> : null}
        {item.author?.name ? <p className={styles.meta}>Người soạn và giảng: {item.author.name}</p> : null}
        {level ? <p className={styles.meta}>Trình độ {level}</p> : null}
        {list.length ? <p className={styles.meta}>{list.join(' · ')}</p> : null}
      </div>
      <div className={styles.rowSide}>
        {fee ? <p className={styles.fee}>{fee}</p> : null}
        {state === 'upcoming' ? <p className={styles.meta}>Học phí công bố khi mở đăng ký</p> : null}
        {opensOn ? <p className={styles.meta}>Dự kiến mở: {opensOn}</p> : null}
        <RowActions item={item} state={state} primary={primary} />
      </div>
    </li>
  );
}

type CompareRow = { label: string; cell: (item: CourseItem) => string | null; always?: boolean };

const COMPARE_ROWS: CompareRow[] = [
  { label: 'Trình độ đầu vào', cell: (i) => i.level_from },
  { label: 'Trình độ đầu ra', cell: (i) => i.level_to },
  { label: 'Số bài học', cell: (i) => (typeof i.lesson_count === 'number' && i.lesson_count > 0 ? `${i.lesson_count} bài` : null) },
  {
    label: 'Bài học thử',
    always: true,
    cell: (i) => (courseRowState({ status: i.status, viewer: null }) === 'upcoming' ? 'Khi mở đăng ký' : 'Có ở trang khoá'),
  },
  { label: 'Thời hạn truy cập', cell: (i) => (typeof i.access_days === 'number' && i.access_days > 0 ? `${i.access_days} ngày` : null) },
  { label: 'Lượt chấm AI', cell: (i) => (i.ai_credits > 0 ? `${i.ai_credits} lượt` : null) },
  {
    label: 'Học phí',
    always: true,
    cell: (i) => (i.status === 'open' ? formatVnd(i.tuition_vnd) : 'Công bố khi mở đăng ký'),
  },
  { label: 'Trạng thái', always: true, cell: (i) => courseRowLabel(i) },
];

function CompareTable({ items }: { items: CourseItem[] }) {
  const rows = COMPARE_ROWS.filter((row) => row.always || items.some((item) => row.cell(item)));
  return (
    <section className={styles.section} aria-labelledby="so-sanh">
      <h2 id="so-sanh">So sánh các khoá</h2>
      <p className={styles.sectionText}>Cùng thông tin như danh sách trên, xếp theo cột để đọc ngang.</p>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-labelledby="so-sanh">
        <table className={styles.table}>
          <thead>
            <tr>
              <td />
              {items.map((item) => <th key={item.slug} scope="col">{item.short_title || item.title}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {items.map((item) => <td key={item.slug}>{row.cell(item) ?? 'Chưa công bố'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** FR-006: runs in the browser only, no API call, nothing stored, first answer chosen. */
function CourseChooser({ items }: { items: CourseItem[] }) {
  const options = useMemo(
    () => items.filter((item) => item.summary).map((item) => ({ value: item.slug, label: item.summary as string })),
    [items],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  if (options.length < 2) return null;
  const value = chosen && options.some((o) => o.value === chosen) ? chosen : options[0].value;
  const course = items.find((item) => item.slug === value);
  if (!course) return null;
  const upcoming = courseRowState(course) === 'upcoming';
  return (
    <section className={styles.section} aria-labelledby="chon-khoa">
      <h2 id="chon-khoa">Chưa biết bắt đầu từ khoá nào?</h2>
      <p className={styles.sectionText}>
        Chọn điều bạn đang cần nhất. Đây là gợi ý theo mô tả, không phải bài kiểm tra; các khoá không có thứ tự bắt
        buộc, cần nhiều kỹ năng thì đăng ký nhiều khoá và học song song.
      </p>
      <div className={styles.chooser}>
        <ChoiceGroup mode="single" legend="Bạn đang cần" options={options} value={value} onChange={setChosen} />
        <div className={styles.suggestion} aria-live="polite">
          <p className={styles.eyebrow}>Gợi ý cho bạn</p>
          <p className={styles.suggestionTitle}>{course.title}</p>
          {upcoming ? (
            <p>
              {course.status === 'closed' ? 'Khoá này đang tạm đóng đăng ký.' : 'Khoá này sắp mở.'} Trong lúc chờ, bạn có thể ôn bằng Thư viện miễn phí, hoặc bấm "Báo cho tôi khi mở" ở
              trang khoá.
            </p>
          ) : (
            <p>Xem trang khoá để học thử bài đầu. Cần thêm kỹ năng khác thì xem khoá đó; các khoá học song song được.</p>
          )}
          <div className={styles.actions}>
            <a className={styles.viewLink} href={courseHref(course.slug)}>Xem khoá <span aria-hidden="true">›</span></a>
            {upcoming ? <a className={styles.viewLink} href="/library">Vào Thư viện</a> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function CourseCatalog({ initialItems }: { initialItems: CourseItem[] }) {
  const { status, user } = useAuth();
  const signedIn = status === 'signed-in';
  const accountId = signedIn ? user?.id ?? null : null;
  const [viewerRead, setViewerRead] = useState<ViewerRead | null>(null);
  const generation = useRef(0);

  const loadViewer = useCallback((id: string, gen: number) => {
    setViewerRead({ accountId: id, status: 'loading' });
    const onError = () => {
      if (gen === generation.current) setViewerRead({ accountId: id, status: 'error' });
    };
    fetchCatalogForViewer().then(
      (data) => {
        if (gen !== generation.current) return;
        if (!Array.isArray(data?.items)) {
          onError();
          return;
        }
        setViewerRead({ accountId: id, status: 'ready', items: data.items });
      },
      onError,
    );
  }, []);

  useEffect(() => {
    const gen = ++generation.current;
    if (accountId) loadViewer(accountId, gen);
    else setViewerRead(null);
    return () => { generation.current += 1; };
  }, [accountId, initialItems, loadViewer]);

  // Never render the previous viewer's result, even before the effect runs.
  const ownRead = viewerRead?.accountId === accountId ? viewerRead : null;
  const items = ownRead?.status === 'ready' ? ownRead.items : initialItems;
  const isLoading = accountId !== null && (!ownRead || ownRead.status === 'loading');
  const counts = catalogCounts(items);
  const primary = primaryLearningSlug(items);
  const activateHref = signedIn ? ACTIVATE_PATH : `/login?next=${encodeURIComponent(ACTIVATE_PATH)}`;

  if (!items.length) {
    return <p className={styles.sectionText}>Chưa có khoá học nào được công bố.</p>;
  }

  return (
    <>
      {ownRead?.status === 'error' ? (
        <Notice
          kind="warning"
          live="alert"
          action={<Button variant="secondary" onClick={() => loadViewer(ownRead.accountId, generation.current)}>Thử lại</Button>}
        >
          Chưa tải được trạng thái khoá học của bạn. Danh sách dưới đây là thông tin chung.
        </Notice>
      ) : null}

      <section className={styles.section} aria-labelledby="danh-sach">
        <div className={styles.listHead}>
          <h2 id="danh-sach">Danh sách khoá</h2>
          <p className={styles.count}>
            {counts.open} khoá đang mở đăng ký · {counts.upcoming} khoá sắp mở
            {counts.closed ? ` · ${counts.closed} khoá tạm đóng đăng ký` : null}
          </p>
        </div>
        <aside className={styles.activate} aria-label="Mã kích hoạt">
          <p>Có mã kích hoạt từ lớp?</p>
          <a href={activateHref}>Nhập mã</a>
        </aside>
        <ol className={styles.list} aria-busy={isLoading || undefined}>
          {items.map((item) => <CourseRow key={item.slug} item={item} primary={item.slug === primary} />)}
        </ol>
      </section>

      <CompareTable items={items} />
      <CourseChooser items={items} />
    </>
  );
}
