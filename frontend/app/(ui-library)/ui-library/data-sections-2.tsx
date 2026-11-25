'use client';

// /ui-library sections for G03-T08 part 2 (UIBASE-0056 FR-005, FR-013):
// Chart, FileUpload and the date/time fields, as drawn on ThanhPhanDuLieu §4,
// §7, §9. Sample data only; nothing is uploaded. "Today" is pinned to
// 17/11/2026 so the screenshots never change with the calendar.
import { useState } from 'react';

import {
  Chart, DateField, DateRangeField, FileUpload, TimeField, checkUploadFile, type DateRange, type UploadFile,
} from '@/components/ui';

import styles from './ui-library.module.css';

const TODAY = '2026-11-17';

const WEEKLY = [
  { label: '28/09', value: 18 }, { label: '05/10', value: 22 }, { label: '12/10', value: 19 }, { label: '19/10', value: 27 },
  { label: '26/10', value: 24 }, { label: '02/11', value: 31 }, { label: '09/11', value: 35 },
];
const BANDS = [
  { label: 'Bài 1', value: 5 }, { label: 'Bài 2', value: 5 }, { label: 'Bài 3', value: 5.5 },
  { label: 'Bài 4', value: 5.5 }, { label: 'Bài 5', value: 5.5 }, { label: 'Bài 6', value: 6 },
];

export function ChartSection({ title }: { title: string }) {
  return (
    <section id="chart" className={styles.section} aria-labelledby="chart-h">
      <h2 id="chart-h">{title}</h2>
      <div className={styles.chartGrid}>
        <div>
          <p className={styles.demoLabel}>Cột</p>
          <Chart
            type="bar"
            title="Bài nộp tăng đều 3 tuần gần đây"
            subtitle="Số bài nộp mỗi tuần · lớp Tue–Thu 19:30"
            seriesLabel="Bài đã nộp"
            categoryLabel="Tuần"
            data={WEEKLY}
            unit="Trục ngang: tuần bắt đầu từ thứ Hai · trục dọc: số bài"
            source="Nguồn: bài nộp trên Aver Learning, cập nhật 16/11/2026 08:00"
          />
        </div>
        <div>
          <p className={styles.demoLabel}>Đường</p>
          <Chart
            type="line"
            title="Band Writing của lớp lên 6.0 sau 6 bài"
            subtitle="Band trung bình mỗi bài · lớp Tue–Thu 19:30"
            seriesLabel="Band trung bình"
            categoryLabel="Bài"
            data={BANDS}
            target={{ value: 6.5, label: 'Mục tiêu của lớp 6.5' }}
            unit="Trục ngang: bài Writing Task 2 được giao · trục dọc: band"
            source="Nguồn: điểm giáo viên đã duyệt, cập nhật 16/11/2026 08:00"
          />
        </div>
        <div>
          <p className={styles.demoLabel}>Trống</p>
          <Chart
            type="line"
            title="Band Speaking theo bài"
            seriesLabel="Band trung bình"
            categoryLabel="Bài"
            data={[{ label: 'Bài 1', value: 5 }]}
            unit=""
            source=""
            emptyTitle="Chưa có bài Speaking nào được chấm"
            emptyBody="Biểu đồ hiện khi lớp có ít nhất 2 bài đã chấm."
          />
          <p className={styles.note}>Không vẽ trục số và đường bằng 0 khi chưa có dữ liệu: người xem sẽ đọc thành “điểm bằng 0”.</p>
        </div>
      </div>
    </section>
  );
}

const SAMPLE_FILES: UploadFile[] = [
  { id: 'f1', name: 'danh-sach-lop-toi.xlsx', status: 'uploading', size: 1992294, loaded: 1258291 },
  { id: 'f2', name: 'de-reading-12.csv', status: 'done', size: 245760, detail: '40 câu' },
  { id: 'f3', name: 'audio-part2.mp3', status: 'error', error: { title: 'Sai định dạng.', body: 'Ô này chỉ nhận .xlsx hoặc .csv. Audio tải ở mục Bài nghe.' } },
  { id: 'f4', name: 'kho-de-toan-bo.xlsx', status: 'error', error: { title: 'Quá cỡ.', body: 'File 38 MB, tối đa 20 MB. Tách thành nhiều file nhỏ hơn.' } },
];

export function FileUploadSection({ title }: { title: string }) {
  const [files, setFiles] = useState<UploadFile[]>(SAMPLE_FILES);
  const add = (picked: File[]) => setFiles((current) => [
    ...current,
    ...picked.map((file, i) => {
      const error = checkUploadFile(file, '.xlsx,.csv', 'File .xlsx hoặc .csv', 20);
      return error
        ? { id: `new-${current.length + i}`, name: file.name, status: 'error' as const, error }
        : { id: `new-${current.length + i}`, name: file.name, status: 'done' as const, size: file.size };
    }),
  ]);
  return (
    <section id="file-upload" className={styles.section} aria-labelledby="file-upload-h">
      <h2 id="file-upload-h">{title}</h2>
      <div className={styles.uploadFrame}>
        <FileUpload
          label="Danh sách học viên"
          accept=".xlsx,.csv"
          acceptLabel="File .xlsx hoặc .csv"
          maxSizeMb={20}
          multiple
          files={files}
          onAdd={add}
          onRemove={(id) => setFiles((f) => f.filter((x) => x.id !== id))}
          onCancel={(id) => setFiles((f) => f.map((x) => (x.id === id ? { ...x, status: 'cancelled' } : x)))}
          onRetry={(id) => setFiles((f) => f.map((x) => (x.id === id ? { ...x, status: 'uploading', loaded: 0 } : x)))}
        />
      </div>
      <p className={styles.note}>Nút “Tiếp tục” của trang chỉ bật khi không còn file đang tải. Khi nhập dữ liệu, file chỉ được đọc để kiểm tra; chưa ghi gì cho tới bước Xác nhận.</p>
    </section>
  );
}

export function DateFieldsSection({ title }: { title: string }) {
  const [due, setDue] = useState('2026-11-24');
  const [start, setStart] = useState('2026-11-16');
  const [time, setTime] = useState('19:30');
  const [range, setRange] = useState<DateRange>({ start: '2026-11-17', end: '2026-11-20' });
  return (
    <section id="date-fields" className={styles.section} aria-labelledby="date-fields-h">
      <h2 id="date-fields-h">{title}</h2>
      <div className={styles.dateGrid} data-testid="date-fields">
        <DateField label="Hạn nộp" value={due} onChange={setDue} min={TODAY} today={TODAY} />
        <DateField
          label="Ngày bắt đầu"
          value={start}
          onChange={setStart}
          today={TODAY}
          error="Ngày bắt đầu phải từ ngày giao bài (17/11/2026) trở đi."
        />
        <TimeField label="Giờ học" value={time} onChange={setTime} from="18:00" to="21:00" unavailable={{ '20:00': 'lớp khác' }} />
        <DateRangeField legend="Khoảng thời gian báo cáo" value={range} onChange={setRange} today={TODAY} />
      </div>
      <p className={styles.note}>Ngày viết dd/mm/yyyy, giờ 24 giờ hh:mm; gõ tay được, lịch chỉ để hỗ trợ; tuần bắt đầu từ thứ Hai. Không dùng ô chọn ngày của trình duyệt vì định dạng đổi theo máy.</p>
    </section>
  );
}
