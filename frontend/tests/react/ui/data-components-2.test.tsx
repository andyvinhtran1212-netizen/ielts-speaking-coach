// UIBASE-0056 G03-T08 part 2 (FR-005): Chart, FileUpload, DateField, TimeField, DateRangeField.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Chart, DateField, DateRangeField, FileUpload, TimeField, checkUploadFile, chartDomain, formatFileSize,
  type DateRange, type UploadFile,
} from '@/components/ui';

afterEach(cleanup);

const WEEKLY = [{ label: '02/11', value: 31 }, { label: '09/11', value: 35 }];

describe('Chart', () => {
  it('a figure with the conclusion title, an SVG summary in words and the numbers in a table', () => {
    render(
      <Chart
        type="bar"
        title="Bài nộp tăng đều 3 tuần gần đây"
        subtitle="Số bài nộp mỗi tuần"
        seriesLabel="Bài đã nộp"
        categoryLabel="Tuần"
        data={WEEKLY}
        unit="Trục ngang: tuần · trục dọc: số bài"
        source="Nguồn: bài nộp trên Aver Learning"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Bài nộp tăng đều 3 tuần gần đây' })).toBeTruthy();
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toBe('Biểu đồ cột: Số bài nộp mỗi tuần, 2 tuần từ 02/11 đến 09/11: 31, 35. Thấp nhất 31, cao nhất 35.');
    const table = screen.getByRole('table', { name: 'Số liệu của biểu đồ' });
    expect(within(table).getByRole('rowheader', { name: 'Bài đã nộp' }).parentElement!.textContent).toBe('Bài đã nộp3135');
    expect(screen.getByText('Nguồn: bài nộp trên Aver Learning').tagName).toBe('FIGCAPTION');
  });

  it('too little data: words, no axis that reads as zero', () => {
    render(<Chart type="line" title="Band Speaking theo bài" seriesLabel="Band" categoryLabel="Bài" data={[{ label: 'Bài 1', value: 5 }]} unit="" source="" emptyTitle="Chưa có bài Speaking nào được chấm" />);
    expect(screen.getByText('Chưa có bài Speaking nào được chấm')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('domains: bars from 0 in nice steps, lines hug the data and the target', () => {
    expect(chartDomain('bar', [18, 35])).toEqual({ min: 0, max: 40, step: 10 });
    expect(chartDomain('line', [5, 6], 6.5)).toEqual({ min: 4, max: 7, step: 1 });
  });
});

describe('FileUpload', () => {
  const file = (name: string, size: number, type = '') => new File([new Uint8Array(1)], name, { type }) as File & { size: number };

  it('says formats and size before anything is picked; a picked file goes to onAdd', () => {
    const onAdd = vi.fn();
    render(<FileUpload label="Danh sách học viên" accept=".xlsx,.csv" acceptLabel="File .xlsx hoặc .csv" maxSizeMb={20} files={[]} onAdd={onAdd} />);
    const input = screen.getByLabelText('Danh sách học viên: chọn file từ máy') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('.xlsx,.csv');
    expect(screen.getByText('File .xlsx hoặc .csv · tối đa 20 MB mỗi file').id).toBe(input.getAttribute('aria-describedby'));
    const picked = file('lop.xlsx', 10);
    fireEvent.change(input, { target: { files: [picked] } });
    expect(onAdd).toHaveBeenCalledWith([picked]);
  });

  it('dragging says how many files will drop; dropping hands them over', () => {
    const onAdd = vi.fn();
    render(<FileUpload label="Đề" accept=".csv" acceptLabel="File .csv" maxSizeMb={5} multiple files={[]} onAdd={onAdd} />);
    const zone = screen.getByText('Kéo file vào đây, hoặc').parentElement!;
    fireEvent.dragEnter(zone, { dataTransfer: { items: [{}, {}], files: [] } });
    expect(screen.getByText('Thả để tải lên 2 file')).toBeTruthy();
    const a = file('a.csv', 1);
    fireEvent.drop(zone, { dataTransfer: { files: [a] } });
    expect(onAdd).toHaveBeenCalledWith([a]);
    expect(screen.queryByText('Thả để tải lên 2 file')).toBeNull();
  });

  it('one row per file with its status in words and one next step; errors are alerts', () => {
    const onCancel = vi.fn();
    const onRemove = vi.fn();
    const files: UploadFile[] = [
      { id: 'u', name: 'lop.xlsx', status: 'uploading', size: 2 * 1024 * 1024, loaded: 1024 * 1024 },
      { id: 'd', name: 'de.csv', status: 'done', size: 240 * 1024, detail: '40 câu' },
      { id: 'e', name: 'audio.mp3', status: 'error', error: { title: 'Sai định dạng.', body: 'Ô này chỉ nhận .xlsx hoặc .csv.' } },
    ];
    render(<FileUpload label="Danh sách" accept=".xlsx,.csv" acceptLabel="File .xlsx hoặc .csv" maxSizeMb={20} files={files} onAdd={vi.fn()} onCancel={onCancel} onRemove={onRemove} />);
    const bar = screen.getByRole('progressbar', { name: 'Tải lên lop.xlsx' });
    expect(bar.getAttribute('aria-valuetext')).toBe('1 MB trên 2 MB');
    expect(screen.getByText(/Đang tải lên · 1 MB trên 2 MB/)).toBeTruthy();
    expect(screen.getByText('Đã tải lên').parentElement!.textContent).toBe('Đã tải lên · 240 KB · 40 câu');
    expect(screen.getByRole('alert').textContent).toBe('Sai định dạng. Ô này chỉ nhận .xlsx hoặc .csv.');
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ tải lên lop.xlsx' }));
    expect(onCancel).toHaveBeenCalledWith('u');
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ file de.csv' }));
    expect(onRemove).toHaveBeenCalledWith('d');
    expect(screen.getByRole('button', { name: 'Chọn file khác' })).toBeTruthy();
    expect(screen.getByText('3 file · 1 xong · 1 đang tải · 1 lỗi')).toBeTruthy();
  });

  it('checkUploadFile words the type and size errors; formatFileSize uses the decimal comma', () => {
    expect(checkUploadFile({ name: 'a.mp3', size: 10 }, '.xlsx,.csv', 'File .xlsx hoặc .csv', 20)).toEqual({ title: 'Sai định dạng.', body: 'Ô này chỉ nhận .xlsx hoặc .csv.' });
    expect(checkUploadFile({ name: 'a.XLSX', size: 38 * 1024 * 1024 }, '.xlsx,.csv', 'File .xlsx hoặc .csv', 20)).toEqual({ title: 'Quá cỡ.', body: 'File 38 MB, tối đa 20 MB. Tách thành nhiều file nhỏ hơn.' });
    expect(checkUploadFile({ name: 'a.wav', size: 10, type: 'audio/wav' }, 'audio/*', 'File âm thanh', 20)).toBeNull();
    expect(formatFileSize(1992294)).toBe('1,9 MB');
    expect(formatFileSize(245760)).toBe('240 KB');
  });
});

function DateHarness({ initial = '', min, max }: { initial?: string; min?: string; max?: string }) {
  const [value, setValue] = useState(initial);
  return <><DateField label="Hạn nộp" value={value} onChange={setValue} min={min} max={max} today="2026-11-17" /><output data-testid="value">{value}</output></>;
}

describe('DateField', () => {
  it('typed dd/mm/yyyy is committed on blur and shows the weekday; an impossible date says why', () => {
    render(<DateHarness />);
    const input = screen.getByRole('textbox', { name: 'Hạn nộp' });
    expect(input.getAttribute('type')).toBe('text');
    fireEvent.change(input, { target: { value: '24/11/26' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('value').textContent).toBe('2026-11-24');
    expect((input as HTMLInputElement).value).toBe('24/11/2026');
    expect(screen.getByText('dd/mm/yyyy · Thứ Ba')).toBeTruthy();
    fireEvent.change(input, { target: { value: '31/11/2026' } });
    fireEvent.blur(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Tháng 11 chỉ có 30 ngày. Bạn kiểm tra lại ngày.').id).toBe(input.getAttribute('aria-describedby'));
    expect(screen.getByTestId('value').textContent).toBe('2026-11-24');
  });

  it('the calendar: Monday first, today and locked days in words, a pick closes it and returns focus', () => {
    render(<DateHarness initial="2026-11-24" min="2026-11-17" />);
    const trigger = screen.getByRole('button', { name: 'Mở lịch chọn hạn nộp' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Chọn hạn nộp' });
    expect(within(dialog).getByRole('heading', { name: 'Tháng 11, 2026' })).toBeTruthy();
    expect(within(dialog).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);
    expect(within(dialog).getByRole('button', { name: 'Thứ Ba, 17/11/2026, hôm nay' })).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Thứ Hai, 16/11/2026, không chọn được' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Thứ Ba, 24/11/2026, đang chọn' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thứ Sáu, 27/11/2026' }));
    expect(screen.getByTestId('value').textContent).toBe('2026-11-27');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('month buttons, arrow keys across months, Esc closes', () => {
    render(<DateHarness initial="2026-11-30" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở lịch chọn hạn nộp' }));
    const day = screen.getByRole('button', { name: 'Thứ Hai, 30/11/2026, đang chọn' });
    expect(day.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(day, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Tháng 12, 2026' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Thứ Ba, 01/12/2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tháng trước' }));
    expect(screen.getByRole('heading', { name: 'Tháng 11, 2026' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mở lịch chọn hạn nộp' }));
  });
});

describe('DateField keyboard and resync', () => {
  it('an empty field whose today is locked still has one reachable, open day; arrows step over locked days', () => {
    render(<DateHarness min="2026-11-24" max="2026-11-26" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở lịch chọn hạn nộp' }));
    const dialog = screen.getByRole('dialog', { name: 'Chọn hạn nộp' });
    const stops = within(dialog).getAllByRole('button').filter((b) => b.hasAttribute('data-day') && b.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute('data-day')).toBe('2026-11-24');
    expect((stops[0] as HTMLButtonElement).disabled).toBe(false);
    // ArrowLeft from the first open day: nothing open before it, focus stays.
    fireEvent.keyDown(stops[0], { key: 'ArrowLeft' });
    expect(stops[0].getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(stops[0], { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-day')).toBe('2026-11-25');
    // Next month is all locked: the tab stop is a day, but none can be chosen, and none is wrongly open.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tháng sau' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tháng trước' }));
    const back = within(dialog).getAllByRole('button').filter((b) => b.getAttribute('tabindex') === '0' && b.hasAttribute('data-day'));
    expect(back.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false]);
  });

  it('picking the current date after a refused edit puts the good text back and clears the error', () => {
    render(<DateHarness initial="2026-11-24" />);
    const input = screen.getByRole('textbox', { name: 'Hạn nộp' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '31/11/2026' } });
    fireEvent.blur(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Mở lịch chọn hạn nộp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thứ Ba, 24/11/2026, đang chọn' }));
    expect(input.value).toBe('24/11/2026');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByTestId('value').textContent).toBe('2026-11-24');
  });
});

describe('TimeField', () => {
  it('typed time is normalised to hh:mm; the list marks the current time and locks unavailable ones', () => {
    function Harness() {
      const [value, setValue] = useState('19:30');
      return <><TimeField label="Giờ học" value={value} onChange={setValue} from="19:00" to="20:00" unavailable={{ '20:00': 'lớp khác' }} /><output data-testid="t">{value}</output></>;
    }
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Giờ học' });
    fireEvent.change(input, { target: { value: '1945' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('t').textContent).toBe('19:45');
    fireEvent.change(input, { target: { value: '25:00' } });
    fireEvent.blur(input);
    expect(screen.getByText('Giờ viết theo 24 giờ, ví dụ 07:05 hoặc 19:30.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Mở danh sách giờ' }));
    const list = screen.getByRole('list', { name: 'Chọn giờ học' });
    expect(within(list).getByRole('button', { name: '19:45 đang chọn' }).getAttribute('aria-pressed')).toBe('true');
    expect((within(list).getByRole('button', { name: '20:00 · lớp khác' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(list).getByRole('button', { name: '19:15' }));
    expect(screen.getByTestId('t').textContent).toBe('19:15');
    expect(screen.queryByRole('list', { name: 'Chọn giờ học' })).toBeNull();
  });

  function Busy() {
    const [value, setValue] = useState('19:30');
    return <><TimeField label="Giờ học" value={value} onChange={setValue} from="19:00" to="20:00" unavailable={{ '20:00': 'lớp khác' }} /><output data-testid="t">{value}</output></>;
  }

  it.each(['Enter', 'blur'])('a busy time typed then %s is refused with its reason; the last good time stays', (how) => {
    render(<Busy />);
    const input = screen.getByRole('textbox', { name: 'Giờ học' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2000' } });
    if (how === 'Enter') fireEvent.keyDown(input, { key: 'Enter' }); else fireEvent.blur(input);
    expect(screen.getByTestId('t').textContent).toBe('19:30');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('20:00 không chọn được: lớp khác. Bạn chọn giờ khác.').id).toBe(input.getAttribute('aria-describedby'));
  });

  it('picking the current time after a refused edit puts the good text back', () => {
    render(<Busy />);
    const input = screen.getByRole('textbox', { name: 'Giờ học' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20:00' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'Mở danh sách giờ' }));
    fireEvent.click(screen.getByRole('button', { name: '19:30 đang chọn' }));
    expect(input.value).toBe('19:30');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('DateRangeField', () => {
  function Harness({ initial = { start: '', end: '' } }: { initial?: DateRange }) {
    const [value, setValue] = useState<DateRange>(initial);
    return <><DateRangeField legend="Khoảng thời gian báo cáo" value={value} onChange={setValue} today="2026-11-17" /><output data-testid="r">{`${value.start}|${value.end}`}</output></>;
  }

  it('first click is the start, second the end; the status counts the days; a third click starts again', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Khoảng thời gian báo cáo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mở lịch chọn khoảng thời gian báo cáo' }));
    const dialog = screen.getByRole('dialog', { name: 'Chọn khoảng ngày' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Thứ Ba, 17\/11\/2026/ }));
    expect(within(dialog).getByRole('status').textContent).toBe('Từ 17/11/2026 · chọn ngày kết thúc');
    const realMatchMedia = window.matchMedia;
    act(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never; });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thứ Sáu, 20/11/2026' }));
    expect(screen.getByTestId('r').textContent).toBe('2026-11-17|2026-11-20');
    // Phone: the sheet stays open until "Xong".
    expect(within(dialog).getByRole('status').textContent).toBe('17/11 – 20/11/2026 · 4 ngày');
    expect(screen.getByRole('button', { name: 'Thứ Tư, 18/11/2026, trong khoảng đã chọn' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thứ Sáu, 20/11/2026, ngày kết thúc' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^Thứ Hai, 23\/11\/2026/ }));
    expect(screen.getByTestId('r').textContent).toBe('2026-11-23|');
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    window.matchMedia = realMatchMedia;
  });

  it('a typed end before the start is refused in words', () => {
    render(<Harness initial={{ start: '2026-11-17', end: '' }} />);
    const end = screen.getByRole('textbox', { name: 'Đến ngày' });
    fireEvent.change(end, { target: { value: '10/11/2026' } });
    fireEvent.blur(end);
    expect(screen.getByText('Ngày kết thúc phải từ ngày bắt đầu trở đi.')).toBeTruthy();
    expect(screen.getByTestId('r').textContent).toBe('2026-11-17|');
  });

  it('a calendar pick after a refused edit shows what the form holds in both boxes', () => {
    render(<Harness initial={{ start: '2026-11-17', end: '' }} />);
    const start = screen.getByRole('textbox', { name: 'Từ ngày' }) as HTMLInputElement;
    const end = screen.getByRole('textbox', { name: 'Đến ngày' }) as HTMLInputElement;
    fireEvent.change(end, { target: { value: '10/11/2026' } });
    fireEvent.blur(end);
    fireEvent.click(screen.getByRole('button', { name: 'Mở lịch chọn khoảng thời gian báo cáo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thứ Sáu, 20/11/2026' }));
    expect(screen.getByTestId('r').textContent).toBe('2026-11-17|2026-11-20');
    expect([start.value, end.value]).toEqual(['17/11/2026', '20/11/2026']);
    expect(end.getAttribute('aria-invalid')).toBeNull();
  });
});
