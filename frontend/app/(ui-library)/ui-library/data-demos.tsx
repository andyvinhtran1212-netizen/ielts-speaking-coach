'use client';

// /ui-library interactive demo for G03-T08: the learner table of
// ThanhPhanDuLieu §1 (sort, multi-select with the action bar, filter chips).
// Sample data from the sheet only; nothing is fetched.
import { useState } from 'react';

import {
  Button, DataTable, StatusBadge, givenName, sortRows, type DataTableColumn, type DataTableSort,
} from '@/components/ui';


type Learner = {
  id: string;
  name: string;
  email: string;
  cls: string;
  band: number | null;
  done: number;
  last: string | null;
  status: 'active' | 'overdue' | 'not_started' | 'expiring';
};

export const SAMPLE_LEARNERS: readonly Learner[] = [
  { id: 'l1', name: 'Nguyễn Minh Anh', email: 'minhanh@example.com', cls: 'Tue–Thu 19:30', band: 6.0, done: 31, last: '2026-11-17', status: 'active' },
  { id: 'l2', name: 'Phạm Gia Huy', email: 'giahuy@example.com', cls: 'Tue–Thu 19:30', band: 5.5, done: 13, last: '2026-11-12', status: 'overdue' },
  { id: 'l3', name: 'Hoàng Mai Chi', email: 'maichi@example.com', cls: 'Mon–Wed 18:00', band: null, done: 0, last: null, status: 'not_started' },
  { id: 'l4', name: 'Ngô Thành Đạt', email: 'thanhdat@example.com', cls: 'Tue–Thu 19:30', band: 6.5, done: 40, last: '2026-11-15', status: 'active' },
  { id: 'l5', name: 'Võ Ngọc Lan', email: 'ngoclan@example.com', cls: 'Mon–Wed 18:00', band: 5.0, done: 22, last: '2026-11-09', status: 'expiring' },
  { id: 'l6', name: 'Đặng Thuỳ Dương', email: 'thuyduong@example.com', cls: 'Tue–Thu 19:30', band: 7.0, done: 46, last: '2026-11-16', status: 'active' },
];

const dayText = (iso: string) => iso.split('-').reverse().join('/');

function Status({ status }: { status: Learner['status'] }) {
  if (status === 'overdue') return <StatusBadge set="work" value="overdue" detail="2 bài liên tiếp" />;
  if (status === 'not_started') return <StatusBadge set="work" value="not_started" />;
  if (status === 'expiring') return <StatusBadge set="access" value="expiring" detail="còn 7 ngày" />;
  return <StatusBadge set="access" value="active" />;
}

export const LEARNER_COLUMNS: readonly DataTableColumn<Learner>[] = [
  { key: 'name', label: 'Học viên', sortable: true, render: (r) => <a href="#data-table">{r.name}</a> },
  { key: 'email', label: 'Email' },
  { key: 'cls', label: 'Lớp' },
  { key: 'band', label: 'Band dự kiến', align: 'end', sortable: true, render: (r) => (r.band === null ? null : r.band.toFixed(1)) },
  { key: 'done', label: 'Bài đã nộp', align: 'end', sortable: true },
  { key: 'last', label: 'Lần học gần nhất', sortable: true, render: (r) => (r.last ? dayText(r.last) : null) },
  { key: 'status', label: 'Trạng thái', render: (r) => <Status status={r.status} /> },
];

const SORT_WORDS: Record<string, string> = {
  name: 'tên học viên', band: 'band dự kiến', done: 'số bài đã nộp', last: 'lần học gần nhất',
};

const FILTERS = ['Khoá: Course 1', 'Kỹ năng: Writing', 'Bắt đầu học: từ 01/09/2026'];

const sortValue = (row: Learner, key: string) => (key === 'name' ? givenName(row.name) : row[key as keyof Learner]);

export function LearnerTableDemo() {
  const [sort, setSort] = useState<DataTableSort>({ key: 'band', direction: 'descending' });
  const [selected, setSelected] = useState<string[]>(['l1', 'l2', 'l4']);
  const [filters, setFilters] = useState<string[]>(FILTERS);
  const rows = sortRows(SAMPLE_LEARNERS, sort, sortValue);
  const sortText = sort
    ? `sắp theo ${SORT_WORDS[sort.key]}, ${sort.direction === 'ascending' ? 'tăng dần' : 'giảm dần'}`
    : 'chưa sắp xếp';

  return (
    <DataTable
      caption={`Học viên lớp Tue–Thu 19:30 và Mon–Wed 18:00 · ${sortText}. Bấm tiêu đề cột để đổi.`}
      columns={LEARNER_COLUMNS}
      rows={rows}
      rowKey={(r) => r.id}
      rowLabel={(r) => r.name}
      selectable
      selected={selected}
      onSelectedChange={setSelected}
      selectionLabel={(n) => `Đã chọn ${n} học viên`}
      bulkLabel="Hành động cho các học viên đã chọn"
      selectionHint="Chưa chọn học viên nào. Đánh dấu ô ở đầu hàng để hiện thanh hành động hàng loạt."
      bulkActions={(
        <>
          <Button variant="secondary" size="md">Giao bài</Button>
          <Button variant="secondary" size="md">Gửi nhắc nhở</Button>
          <Button variant="secondary" size="md">Xuất danh sách</Button>
        </>
      )}
      bulkDanger={<Button variant="secondary" size="md">Khoá quyền học…</Button>}
      sort={sort}
      onSort={setSort}
      filters={filters.map((label) => ({ label, onRemove: () => setFilters((f) => f.filter((x) => x !== label)) }))}
      onClearFilters={() => setFilters([])}
      resultLabel={`${rows.length} học viên`}
      actions={(r) => <a href={`#data-table-${r.id}`}>Xem</a>}
      stickyFirstColumn
      emptyState={<p>Không có học viên nào.</p>}
    />
  );
}
