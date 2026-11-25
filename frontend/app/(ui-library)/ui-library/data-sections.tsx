'use client';

// /ui-library sections for G03-T08 part 1 (UIBASE-0056 FR-005, FR-013,
// FR-018): DataTable and StatCard, as drawn on ThanhPhanDuLieu §1–3. Sample
// data only. A client module: the tables take render functions.
import {
  Button, DataTable, DataTableEmpty, StatCard, StatCardGrid, StatusBadge, formatCount, type DataTableColumn,
} from '@/components/ui';

import { LEARNER_COLUMNS, LearnerTableDemo, SAMPLE_LEARNERS } from './data-demos';
import styles from './ui-library.module.css';

type Test = {
  id: string;
  title: string;
  skill: string;
  questions: number;
  attempts: number | null;
  updated: string;
  status: 'draft' | 'published' | 'archived';
  issue?: string;
};

const TESTS: readonly Test[] = [
  { id: 't1', title: 'Đề Reading số 13', skill: 'Reading', questions: 38, attempts: null, updated: '16/11/2026', status: 'draft', issue: 'Thiếu 2 câu' },
  { id: 't2', title: 'Writing Task 2 · Opinion 31', skill: 'Writing', questions: 1, attempts: null, updated: '15/11/2026', status: 'draft' },
  { id: 't3', title: 'Đề Reading số 12', skill: 'Reading', questions: 40, attempts: 1284, updated: '14/11/2026', status: 'published' },
  { id: 't4', title: 'Đề Listening số 7', skill: 'Listening', questions: 40, attempts: 962, updated: '10/11/2026', status: 'published' },
  { id: 't5', title: 'Speaking Part 2 · Bộ 4', skill: 'Speaking', questions: 12, attempts: 311, updated: '02/11/2026', status: 'archived' },
];

const TEST_COLUMNS: readonly DataTableColumn<Test>[] = [
  { key: 'title', label: 'Tên đề' },
  { key: 'skill', label: 'Kỹ năng', lang: 'en' },
  { key: 'questions', label: 'Câu hỏi', align: 'end' },
  { key: 'attempts', label: 'Lượt làm', align: 'end', render: (r) => (r.attempts === null ? null : formatCount(r.attempts)) },
  { key: 'updated', label: 'Cập nhật', sortable: true },
  {
    key: 'status',
    label: 'Trạng thái',
    render: (r) => (
      <>
        <StatusBadge set="content" value={r.status} />
        {r.issue ? <strong className={styles.tableIssue}> {r.issue}</strong> : null}
      </>
    ),
  },
];

const SHORT_COLUMNS = LEARNER_COLUMNS.filter((c) => ['name', 'band', 'done', 'status'].includes(c.key));

export function DataTableSection({ title }: { title: string }) {
  return (
    <section id="data-table" className={styles.section} aria-labelledby="data-table-h">
      <h2 id="data-table-h">{title}</h2>
      <p className={styles.demoLabel}>Tìm, lọc, chọn nhiều, sắp xếp · bấm tiêu đề cột, ô chọn, chip bộ lọc · cột tên và cột hành động ghim khi cuộn ngang</p>
      <div data-testid="data-table-learners"><LearnerTableDemo /></div>

      <p className={styles.demoLabel}>Mật độ admin · hàng 40px · một hàng đang chọn · một hàng có vấn đề</p>
      <DataTable
        caption="Kho đề · sắp theo ngày cập nhật, mới nhất trước"
        captionHidden
        density="dense"
        columns={TEST_COLUMNS}
        rows={TESTS}
        rowKey={(r) => r.id}
        selectable
        selected={['t2']}
        selectionLabel={(n) => `Đã chọn ${n} đề`}
        bulkActions={<Button variant="secondary" size="sm">Phát hành</Button>}
        sort={{ key: 'updated', direction: 'descending' }}
        onSort={() => {}}
        actions={() => <a href="#data-table">Sửa</a>}
        emptyState={<DataTableEmpty title="Kho đề chưa có đề nào" />}
      />

      <div className={styles.tableStates}>
        <div>
          <p className={styles.demoLabel}>Bảng trống · do bộ lọc</p>
          <DataTable
            caption="Học viên khớp bộ lọc"
            captionHidden
            columns={SHORT_COLUMNS}
            rows={[]}
            rowKey={(r) => r.id}
            emptyState={(
              <DataTableEmpty
                title="Không có học viên nào khớp bộ lọc"
                body="Thử bỏ bớt bộ lọc hoặc tìm bằng email."
                action={<Button variant="secondary">Xoá bộ lọc</Button>}
              />
            )}
          />
        </div>
        <div>
          <p className={styles.demoLabel}>Bảng đang tải</p>
          <DataTable
            caption="Danh sách học viên"
            captionHidden
            columns={SHORT_COLUMNS}
            rows={[]}
            rowKey={(r) => r.id}
            loading
            loadingLabel="Đang tải danh sách học viên…"
            emptyState={null}
          />
        </div>
      </div>

      <p className={styles.demoLabel}>Hộp hẹp như điện thoại · bảng cuộn ngang trong hộp, cột tên ghim trái</p>
      <div className={styles.narrowFrame} data-testid="data-table-narrow">
        <DataTable
          caption="Tue–Thu 19:30 · sắp theo band, giảm dần"
          captionHidden
          columns={SHORT_COLUMNS}
          rows={SAMPLE_LEARNERS.slice(0, 4)}
          rowKey={(r) => r.id}
          rowLabel={(r) => r.name}
          stickyFirstColumn
          emptyState={null}
        />
      </div>
      <p className={styles.note}>Sắp xếp: lần một tăng, lần hai giảm, lần ba bỏ; ô trống luôn cuối; tên sắp theo tên gọi. Ô trống ghi “chưa có”. Hành động nguy hiểm tách bên phải thanh và hỏi lại.</p>
    </section>
  );
}

export function StatCardSection({ title }: { title: string }) {
  return (
    <section id="stat-card" className={styles.section} aria-labelledby="stat-card-h">
      <h2 id="stat-card-h">{title}</h2>
      <StatCardGrid>
        <StatCard
          label="Bài nộp 7 ngày qua"
          value="35"
          trend="up"
          comparison="tăng 4 so với tuần trước"
          context="10/11 – 16/11/2026 · lớp Tue–Thu 19:30"
        />
        <StatCard
          label="Học viên học ít nhất 1 lần"
          value="14"
          of="trên 18"
          trend="down"
          comparison="giảm 2 so với tuần trước"
          context={<a href="#stat-card">Xem 4 học viên chưa học</a>}
        />
        <StatCard label="Band Writing trung bình" value="5.6" trend="flat" comparison="không đổi so với tháng trước" context="Tính trên 42 bài đã chấm" />
        <StatCard label="Bài nộp 7 ngày qua" state="loading" />
      </StatCardGrid>
      <StatCardGrid className={styles.gapTop}>
        <StatCard
          label="Band Speaking trung bình"
          value="5.0"
          state="insufficient"
          comparison="Chưa so sánh được: cần ít nhất 2 tuần có bài đã chấm, hiện mới có 1 tuần."
        />
        <StatCard label="Bài nộp 7 ngày qua" state="error" action={<Button variant="secondary">Tải lại</Button>} />
      </StatCardGrid>
      <p className={styles.note}>Chữ “tăng / giảm / không đổi” là tín hiệu, mũi tên chỉ đi kèm; không tô xanh hay đỏ. Điện thoại: 2 thẻ một hàng, số 32px; quá 4 thẻ thì dùng bảng.</p>
    </section>
  );
}
