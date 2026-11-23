// UIBASE-0056 G03-T08 part 1 (FR-005, FR-018): DataTable and StatCard behaviour.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DataTable, DataTableEmpty, StatCard, givenName, nextSort, sortRows, type DataTableColumn, type DataTableSort,
} from '@/components/ui';

import { LearnerTableDemo } from '@/app/(ui-library)/ui-library/data-demos';

afterEach(cleanup);

type Row = { id: string; name: string; band: number | null; email?: string };

const ROWS: Row[] = [
  { id: 'a', name: 'Nguyễn Minh Anh', band: 6, email: 'minhanh@example.com' },
  { id: 'b', name: 'Phạm Gia Huy', band: 5.5 },
  { id: 'c', name: 'Hoàng Mai Chi', band: null },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'name', label: 'Học viên', sortable: true },
  { key: 'email', label: 'Email' },
  { key: 'band', label: 'Band dự kiến', align: 'end', sortable: true },
];

function Controlled({ initialSort = null, initialSelected = [] as string[], onAction = vi.fn() }) {
  const [sort, setSort] = useState<DataTableSort>(initialSort);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  return (
    <DataTable
      caption="Học viên lớp Tue–Thu 19:30"
      columns={COLUMNS}
      rows={sortRows(ROWS, sort, (r, k) => (k === 'name' ? givenName(r.name) : r[k as keyof Row]))}
      rowKey={(r) => r.id}
      selectable
      selected={selected}
      onSelectedChange={setSelected}
      selectionLabel={(n) => `Đã chọn ${n} học viên`}
      bulkLabel="Hành động cho các học viên đã chọn"
      bulkActions={<button type="button" onClick={onAction}>Giao bài</button>}
      sort={sort}
      onSort={setSort}
      actions={(r) => <a href={`/s/${r.id}`}>Xem</a>}
      emptyState={<DataTableEmpty title="Không có học viên nào" />}
    />
  );
}

const bodyNames = () => within(screen.getByRole('table')).getAllByRole('rowheader').map((th) => th.textContent);

describe('DataTable', () => {
  it('is a real table with its caption; the name column is a row header; empty cells say "chưa có"', () => {
    render(<Controlled />);
    const table = screen.getByRole('table', { name: 'Học viên lớp Tue–Thu 19:30' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
      ['', 'Học viên', 'Email', 'Band dự kiến', 'Hành động'],
    );
    expect(bodyNames()).toEqual(['Nguyễn Minh Anh', 'Phạm Gia Huy', 'Hoàng Mai Chi']);
    const chi = screen.getByRole('row', { name: /Hoàng Mai Chi/ });
    expect(within(chi).getAllByText('chưa có')).toHaveLength(2);
  });

  it('sort headers carry aria-sort and say the direction: ascending, descending, then none', () => {
    render(<Controlled />);
    const header = () => screen.getByRole('columnheader', { name: /Band dự kiến/ });
    expect(header().getAttribute('aria-sort')).toBe('none');
    fireEvent.click(within(header()).getByRole('button'));
    expect(header().getAttribute('aria-sort')).toBe('ascending');
    expect(header().textContent).toContain('tăng');
    expect(bodyNames()).toEqual(['Phạm Gia Huy', 'Nguyễn Minh Anh', 'Hoàng Mai Chi']);
    fireEvent.click(within(header()).getByRole('button'));
    expect(header().getAttribute('aria-sort')).toBe('descending');
    expect(header().textContent).toContain('giảm');
    // Empty values stay last in both directions.
    expect(bodyNames()).toEqual(['Nguyễn Minh Anh', 'Phạm Gia Huy', 'Hoàng Mai Chi']);
    fireEvent.click(within(header()).getByRole('button'));
    expect(header().getAttribute('aria-sort')).toBe('none');
    // A column without `sortable` has no aria-sort and no button.
    const email = screen.getByRole('columnheader', { name: 'Email' });
    expect(email.hasAttribute('aria-sort')).toBe(false);
    expect(within(email).queryByRole('button')).toBeNull();
  });

  it('names sort by given name (Vietnamese order)', () => {
    render(<Controlled initialSort={{ key: 'name', direction: 'ascending' }} />);
    expect(bodyNames()).toEqual(['Nguyễn Minh Anh', 'Hoàng Mai Chi', 'Phạm Gia Huy']);
  });

  it('selection: the bar appears with the count, the header box has three states, "Bỏ chọn" clears', () => {
    const onAction = vi.fn();
    render(<Controlled onAction={onAction} />);
    expect(screen.queryByRole('region', { name: 'Hành động cho các học viên đã chọn' })).toBeNull();
    const all = screen.getByRole('checkbox', { name: 'Chọn cả trang' }) as HTMLInputElement;
    expect(all.checked).toBe(false);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Phạm Gia Huy' }));
    const bar = screen.getByRole('region', { name: 'Hành động cho các học viên đã chọn' });
    expect(within(bar).getByText('Đã chọn 1 học viên')).toBeTruthy();
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(true);
    fireEvent.click(within(bar).getByRole('button', { name: 'Giao bài' }));
    expect(onAction).toHaveBeenCalledTimes(1);

    fireEvent.click(all);
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    expect(within(bar).getByText('Đã chọn 3 học viên')).toBeTruthy();

    fireEvent.click(all);
    expect(screen.queryByRole('region', { name: 'Hành động cho các học viên đã chọn' })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Hoàng Mai Chi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn' }));
    expect(screen.queryByRole('region', { name: 'Hành động cho các học viên đã chọn' })).toBeNull();
    expect(screen.getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true);
  });

  it('rows outside the current page stay selected when the header box toggles this page', () => {
    const onSelectedChange = vi.fn();
    render(
      <DataTable
        caption="Trang 2"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        selectable
        selected={['elsewhere']}
        onSelectedChange={onSelectedChange}
        emptyState={null}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn cả trang' }));
    expect(onSelectedChange).toHaveBeenLastCalledWith(['elsewhere', 'a', 'b', 'c']);
  });

  it('filters: chips remove one by one, "Xoá bộ lọc" clears; the result count is a status', () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    const { rerender } = render(
      <DataTable
        caption="Học viên"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        filters={[{ label: 'Kỹ năng: Writing', onRemove }]}
        onClearFilters={onClear}
        resultLabel="3 học viên"
        emptyState={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Kỹ năng: Writing' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá bộ lọc' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('3 học viên');
    rerender(
      <DataTable caption="Học viên" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} filters={[]} onClearFilters={onClear} emptyState={null} />,
    );
    expect(screen.getByText('chưa có bộ lọc nào.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xoá bộ lọc' })).toBeNull();
  });

  it('empty: one row spanning every column with the empty state', () => {
    render(
      <DataTable
        caption="Học viên"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r: Row) => r.id}
        selectable
        actions={() => null}
        emptyState={<DataTableEmpty title="Không có học viên nào khớp bộ lọc" body="Thử bỏ bớt bộ lọc." action={<button type="button">Xoá bộ lọc</button>} />}
      />,
    );
    const cell = screen.getByText('Không có học viên nào khớp bộ lọc').closest('td')!;
    expect(cell.getAttribute('colspan')).toBe('5');
    expect(within(cell).getByRole('button', { name: 'Xoá bộ lọc' })).toBeTruthy();
  });

  it('loading: aria-busy table, skeleton rows hidden from screen readers, a status line', () => {
    render(<DataTable caption="Học viên" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} loading loadingLabel="Đang tải danh sách học viên…" emptyState={null} />);
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Đang tải danh sách học viên…');
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
  });

  it('actions sit in a "Hành động" column; stickyFirstColumn marks the select and name cells', () => {
    const { container } = render(
      <DataTable caption="Học viên" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} selectable stickyFirstColumn actions={(r) => <a href={`/s/${r.id}`}>Xem</a>} emptyState={null} />,
    );
    expect(screen.getAllByRole('link', { name: 'Xem' }).map((a) => a.getAttribute('href'))).toEqual(['/s/a', '/s/b', '/s/c']);
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap.className).toMatch(/sticky/);
    // Row headers stay the name column even when it is pinned.
    expect(bodyNames()).toEqual(['Nguyễn Minh Anh', 'Phạm Gia Huy', 'Hoàng Mai Chi']);
  });

  it('helpers: nextSort cycles, sortRows keeps empties last and does not mutate', () => {
    expect(nextSort(null, 'band')).toEqual({ key: 'band', direction: 'ascending' });
    expect(nextSort({ key: 'band', direction: 'ascending' }, 'band')).toEqual({ key: 'band', direction: 'descending' });
    expect(nextSort({ key: 'band', direction: 'descending' }, 'band')).toBeNull();
    expect(nextSort({ key: 'band', direction: 'descending' }, 'name')).toEqual({ key: 'name', direction: 'ascending' });
    const input = [{ v: null }, { v: 2 }, { v: 10 }, { v: '' }];
    expect(sortRows(input, { key: 'v', direction: 'descending' }, (r) => r.v).map((r) => r.v)).toEqual([10, 2, null, '']);
    expect(input.map((r) => r.v)).toEqual([null, 2, 10, '']);
  });

  it('the /ui-library learner demo sorts, selects and removes filters', () => {
    render(<LearnerTableDemo />);
    expect(screen.getByRole('region', { name: 'Hành động cho các học viên đã chọn' }).textContent).toContain('Đã chọn 3 học viên');
    expect(screen.getByRole('columnheader', { name: /Band dự kiến/ }).getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Kỹ năng: Writing' }));
    expect(screen.queryByRole('button', { name: 'Bỏ lọc Kỹ năng: Writing' })).toBeNull();
    expect(screen.getByRole('table').querySelector('caption')!.textContent).toContain('band dự kiến, giảm dần');
  });
});

describe('StatCard', () => {
  it('one number, its label and the comparison in words; the arrow is decorative', () => {
    const { container } = render(<StatCard label="Bài nộp 7 ngày qua" value="35" trend="up" comparison="tăng 4 so với tuần trước" context="10/11 – 16/11/2026" />);
    expect(screen.getByText('Bài nộp 7 ngày qua')).toBeTruthy();
    expect(screen.getByText('35')).toBeTruthy();
    expect(screen.getByText('tăng 4 so với tuần trước')).toBeTruthy();
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('loading: aria-busy and a status line; error: the words and the retry action, no number', () => {
    const { rerender, container } = render(<StatCard label="Bài nộp 7 ngày qua" value="35" state="loading" />);
    expect(container.firstElementChild!.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Đang tải số liệu…');
    expect(screen.queryByText('35')).toBeNull();
    rerender(<StatCard label="Bài nộp 7 ngày qua" value="35" state="error" action={<button type="button">Tải lại</button>} />);
    expect(screen.getByText('Chưa tải được số liệu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tải lại' })).toBeTruthy();
    expect(screen.queryByText('35')).toBeNull();
  });

  it('insufficient data keeps the number and drops the arrow', () => {
    const { container } = render(<StatCard label="Band Speaking trung bình" value="5.0" trend="up" state="insufficient" comparison="Chưa so sánh được: cần ít nhất 2 tuần có bài đã chấm." />);
    expect(screen.getByText('5.0')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });
});
