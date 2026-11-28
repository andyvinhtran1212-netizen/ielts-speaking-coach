'use client';

// MOCKORG-0086 FR-140 (G09-T32): "Kỳ thi" list. Reads GET /admin/mock-exams
// only; state, count and next step are what the API says.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button, Notice, PageState } from '@/components/ui';
import { messageOf } from '@/components/admin-directory-ui';
import {
  LIST_FILTERS,
  MODE_LABELS,
  audienceCopy,
  examHref,
  filterCounts,
  filterOrgExams,
  nextStepCopy,
  normalizeOrgExamList,
  skillLetters,
  stateLabel,
  whenCopy,
} from '@/lib/mock-exam-org-model.mjs';

import styles from './mock-exam-org.module.css';

type OrgExam = import('@/lib/mock-exam-org-model.mjs').OrgExam;

export function MockExamList() {
  const [rows, setRows] = useState<OrgExam[] | null>(null);
  const [malformed, setMalformed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const request = useRef(0);

  const load = useCallback(async () => {
    const mine = ++request.current;
    setError(null);
    try {
      const list = normalizeOrgExamList(await window.api.get<unknown>('/admin/mock-exams'));
      if (mine !== request.current) return;
      if (!list) throw new Error('Danh sách kỳ thi sai định dạng.');
      setRows(list.rows);
      setMalformed(list.malformed);
    } catch (caught) {
      if (mine === request.current) setError(messageOf(caught));
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  const counts = useMemo(() => filterCounts(rows || []), [rows]);
  const shown = useMemo(() => filterOrgExams(rows || [], filter), [rows, filter]);
  const unknown = (rows || []).some((row) => row.state === null);

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1>Kỳ thi</h1>
          <p>Thi thử cho một hay nhiều lớp và học viên lẻ, theo Phòng thi cùng giờ hoặc Làm trong khoảng thời gian.</p>
        </div>
        <Button href="/admin/mock-tests/new">Tổ chức kỳ thi</Button>
      </header>

      {error && rows === null && (
        <PageState
          kind="error"
          title="Chưa tải được danh sách kỳ thi"
          body={`Kỳ thi đang diễn ra vẫn chạy bình thường; thử lại sau ít phút. (${error})`}
          action={<Button variant="secondary" onClick={() => void load()}>Thử lại</Button>}
        />
      )}
      {error && rows !== null && <Notice kind="error" title="Không làm mới được danh sách">Đang giữ danh sách cũ. {error}</Notice>}
      {rows === null && !error && <PageState kind="loading" title="Đang tải kỳ thi…" />}

      {rows !== null && rows.length === 0 && (
        <PageState
          kind="empty"
          title="Chưa có kỳ thi nào"
          body="Tổ chức kỳ thi: chọn kỹ năng và đề, thêm lớp hoặc học viên, rồi chọn Phòng thi cùng giờ hay Làm trong khoảng thời gian. Kỳ thi ở Nháp tới khi bạn lên lịch."
          action={<Button href="/admin/mock-tests/new">Tổ chức kỳ thi</Button>}
        />
      )}

      {rows !== null && rows.length > 0 && (
        <>
          {malformed > 0 && <Notice kind="warning">{malformed} kỳ thi sai định dạng đã bị bỏ khỏi danh sách; danh sách có thể chưa đủ.</Notice>}
          {unknown && <Notice kind="warning">Chưa đọc được trạng thái của một số kỳ thi đã kết thúc. Tải lại sau ít phút.</Notice>}
          <div className={styles.filters} role="group" aria-label="Lọc theo trạng thái">
            {LIST_FILTERS.map((f) => (
              <button key={f.id} type="button" className={styles.chip} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}<span>{counts[f.id]}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className={styles.legend}>Không có kỳ thi nào ở trạng thái này.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Kỳ thi</th>
                  <th scope="col">Người thi</th>
                  <th scope="col">Cách thi</th>
                  <th scope="col">Ngày giờ</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col" className={styles.hideNarrow}>Kỹ năng</th>
                  <th scope="col">Việc tiếp theo</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((exam) => (
                  <tr key={exam.id}>
                    <td><a href={examHref(exam)}>{exam.title}</a></td>
                    <td>{audienceCopy(exam)}</td>
                    <td>{MODE_LABELS[exam.mode as keyof typeof MODE_LABELS]}</td>
                    <td>{whenCopy(exam)}</td>
                    <td className={styles.state}>{stateLabel(exam.state)}</td>
                    <td className={styles.hideNarrow}><span aria-label={exam.skills.join(', ')}>{skillLetters(exam.skills)}</span></td>
                    <td>{nextStepCopy(exam)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={styles.legend}>Kỹ năng: L Listening · R Reading · W Writing · S Speaking. Thi bù của một người nằm trong kỳ thi gốc, không thành kỳ thi riêng.</p>
        </>
      )}
    </main>
  );
}
