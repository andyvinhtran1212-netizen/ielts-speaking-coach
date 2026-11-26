// `/library/speaking` — Speaking shelf of the public Library (LIBRARY-0061
// T013; tờ DeSpeakingDanhSach). FR-030 filters in the URL, groups by topic;
// FR-031 the answer status always in words; FR-062 `q=` pages are noindex.
//
// Public, no account (FR-001). The list is read per request with `no-store`.
// An empty filtered result lists one "Bỏ …" line per active filter whose
// removal shows questions, with the real count from the API (`relaxed`).
// Not in this task: the signed-in "Bạn" column (T016).
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { CourseLinkLine } from '@/components/library/course-link-line';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { PageState } from '@/components/ui/page-state';
import { answerStatus } from '@/lib/library-cues.mjs';

import { getLibrary, speakingHref, SPEAKING_PATH, type SpeakingList } from './speaking-data';
import { SpeakingFilters, type Filters } from './speaking-filters';
import { apiQuery, describeFilters, filterQuery, groupByTopic, readFilters, relaxSuggestions } from './speaking-list-model.mjs';
import styles from './speaking.module.css';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TITLE = 'Đề IELTS Speaking và câu trả lời mẫu Part 1, 2, 3 | Aver Learning';
const DESCRIPTION =
  'Đề IELTS Speaking xếp theo chủ đề, đủ ba Part, kèm câu trả lời mẫu (giọng đọc tổng hợp), lời thoại, dàn ý và từ vựng. Miễn phí, không cần tài khoản.';

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const filters = readFilters(await searchParams);
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: SPEAKING_PATH },
    ...(filters.q ? { robots: { index: false, follow: true } } : {}),
  };
}

function PartsAside() {
  return (
    <aside className={styles.partsAside} aria-labelledby="ba-part">
      <h2 id="ba-part" className={styles.asideTitle}>Ba Part trong phòng thi</h2>
      <dl>
        <dt>Part 1</dt>
        <dd>Hỏi đáp ngắn về bản thân và đời sống hằng ngày, 4–5 phút.</dd>
        <dt>Part 2</dt>
        <dd>Một thẻ đề: 1 phút chuẩn bị, nói 1–2 phút.</dd>
        <dt>Part 3</dt>
        <dd>Thảo luận mở rộng từ chủ đề Part 2, 4–5 phút.</dd>
      </dl>
    </aside>
  );
}

function TopicNav({ list, filters }: { list: SpeakingList | null; filters: Filters }) {
  if (!list || list.topics.length === 0) return null;
  return (
    <nav aria-label="Chủ đề" className={styles.topics}>
      <h2 className={styles.asideTitle}>Chủ đề</h2>
      <ul>
        <li>
          <a href={`${SPEAKING_PATH}${filterQuery({ ...filters, chude: null })}`} aria-current={filters.chude ? undefined : 'true'}>
            Tất cả
          </a>
        </li>
        {list.topics.map((topic) => {
          const count = list.facets.topic[topic.slug];
          return (
            <li key={topic.slug}>
              <a
                href={`${SPEAKING_PATH}${filterQuery({ ...filters, chude: topic.slug })}`}
                aria-current={filters.chude === topic.slug ? 'true' : undefined}
              >
                {topic.label_vi || topic.slug}
                {count ? <span className={styles.count}>{count}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Groups({ list }: { list: SpeakingList }) {
  return (
    <>
      {groupByTopic(list.items, list.topics).map((group) => (
        <section key={group.slug ?? 'khac'} className={styles.group} aria-labelledby={`nhom-${group.slug ?? 'khac'}`}>
          <h2 id={`nhom-${group.slug ?? 'khac'}`} className={styles.groupTitle}>{group.label}</h2>
          <ul className={styles.rows}>
            {group.items.map((item) => (
              <li key={item.slug}>
                <a href={speakingHref(item.slug)} className={styles.row}>
                  <span className={styles.rowPart}>Part {item.part}</span>
                  <span className={styles.rowTitle}>
                    <span lang="en" className={styles.rowEn}>{item.title_en}</span>
                    {item.title_vi ? <span className={styles.rowVi}>{item.title_vi}</span> : null}
                  </span>
                  <span className={styles.rowStatus}>{answerStatus(item)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

async function loadList(filters: Filters): Promise<{ list: SpeakingList | null; filters: Filters }> {
  const first = await getLibrary<SpeakingList>(`/api/library/speaking${apiQuery(filters)}`);
  if (first.ok) return { list: first.data, filters };
  // A topic that left the shelf (422): show the list without that filter.
  if (first.status === 422 && filters.chude) {
    const rest = { ...filters, chude: null };
    const again = await getLibrary<SpeakingList>(`/api/library/speaking${apiQuery(rest)}`);
    if (again.ok) return { list: again.data, filters: rest };
  }
  return { list: null, filters };
}

function ListBody({ list, filters }: { list: SpeakingList | null; filters: Filters }) {
  const filtered = Boolean(filters.part || filters.chude || filters.video || filters.q);
  const reload = `${SPEAKING_PATH}${filterQuery(filters)}`;
  const topicLabel = list?.topics.find((t) => t.slug === filters.chude)?.label_vi ?? null;
  let body;
  if (!list) {
    body = (
      <PageState
        kind="error"
        title="Chưa tải được danh sách đề"
        body="Bộ lọc của bạn vẫn giữ nguyên."
        action={<a href={reload}>Tải lại</a>}
      />
    );
  } else if (list.total === 0 && !filtered) {
    body = <PageState kind="empty" title="Chưa có đề nào" body="Kệ Speaking chưa có đề nào kèm câu trả lời mẫu." />;
  } else if (list.total === 0) {
    const suggestions = relaxSuggestions(filters, list.relaxed, topicLabel);
    body = (
      <PageState
        kind="empty"
        label="Không có kết quả"
        title="Không có đề nào khớp bộ lọc"
        body={`Đang lọc: ${describeFilters(filters, topicLabel)}.`}
        action={(
          <div className={styles.relax}>
            {suggestions.length ? (
              <>
                <p>Gỡ bớt một điều kiện để xem thêm:</p>
                <ul>
                  {suggestions.map((line) => (
                    <li key={line.key}>
                      <a href={`${SPEAKING_PATH}${line.query}`}>{line.label}</a>
                      <span className={styles.relaxCount}> còn {line.count} đề</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <a href={SPEAKING_PATH}>Xoá mọi bộ lọc</a>
          </div>
        )}
      />
    );
  } else {
    body = <Groups list={list} />;
  }
  return (
    <div className={styles.layout}>
      <div className={styles.side}>
        <TopicNav list={list} filters={filters} />
        <PartsAside />
      </div>
      <div className={styles.main}>
        <SpeakingFilters filters={filters} />
        {list && list.total > 0 ? (
          <p className={styles.result} role="status">
            {list.total} đề{filtered ? ` · ${describeFilters(filters, topicLabel)}` : ''}
            {filtered ? <> · <a href={SPEAKING_PATH}>Xoá bộ lọc</a></> : null}
          </p>
        ) : null}
        {body}
      </div>
    </div>
  );
}

async function SpeakingShelf({ searchParams }: { searchParams: SearchParams }) {
  // Per request: never prerendered at build.
  await connection();
  const { list, filters } = await loadList(readFilters(await searchParams));
  return <ListBody list={list} filters={filters} />;
}

export default function SpeakingShelfPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className={styles.page}>
      <Breadcrumb items={[{ label: 'Thư viện', href: '/library' }, { label: 'Đề Speaking và video trả lời mẫu' }]} />
      <header className={styles.intro}>
        <h1>Đề Speaking và video trả lời mẫu</h1>
        <p>
          Đề IELTS Speaking xếp theo chủ đề, đủ ba Part. Đề có video cho bạn nghe một câu trả lời trọn vẹn (giọng đọc
          tổng hợp), đọc lời thoại chạy theo video và các ghi chú về từ vựng, cấu trúc đáng học. Đề chưa có video vẫn có
          câu trả lời mẫu dạng chữ. Đọc và xem miễn phí, không cần tài khoản.
        </p>
      </header>
      <Suspense fallback={<PageState kind="loading" title="Đang tải danh sách đề" />}>
        <SpeakingShelf searchParams={searchParams} />
      </Suspense>
      <CourseLinkLine href="/" linkLabel="Xem các khoá">
        Muốn tự nói theo đề và được chấm theo bốn tiêu chí Speaking? Việc đó cần một khoá học.
      </CourseLinkLine>
    </div>
  );
}
