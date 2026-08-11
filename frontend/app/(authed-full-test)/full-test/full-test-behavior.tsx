'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface MockExamSummary {
  id: string;
  code: string;
  title?: string | null;
  review_sla_days?: number | null;
  exam_mode?: string | null;
  blocked_by_sitting_id?: string | null;
  my_sitting_id?: string | null;
}

interface MockExamListPayload {
  exams?: MockExamSummary[];
}

interface KeyedState<T> {
  key: string;
  value: T;
}

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

function ExamAction({ exam }: { exam: MockExamSummary }) {
  if (exam.blocked_by_sitting_id) {
    return (
      <>
        <p className="ft-muted" style={{ color: 'var(--av-warning)', margin: '0 0 8px' }}>
          <strong>Bạn đang có một bài thi chưa hoàn thành.</strong> Hãy hoàn thành bài đó trước.
        </p>
        <a
          className="av-btn"
          style={{ display: 'inline-block' }}
          href={`/pages/mock-exam.html?sitting=${encodeURIComponent(exam.blocked_by_sitting_id)}`}
        >
          ← Quay lại bài đang thi
        </a>
      </>
    );
  }

  const target = exam.my_sitting_id
    ? `/pages/mock-exam.html?sitting=${encodeURIComponent(exam.my_sitting_id)}`
    : `/pages/mock-exam.html?code=${encodeURIComponent(exam.code)}`;
  return (
    <a className="av-btn av-btn--primary" style={{ display: 'inline-block' }} href={target}>
      {exam.my_sitting_id ? 'Tiếp tục bài đang làm →' : 'Bắt đầu →'}
    </a>
  );
}

function ExamCard({ exam }: { exam: MockExamSummary }) {
  const retake = exam.exam_mode === 'retake';
  // Preserve the legacy `review_sla_days || 3` display contract. A falsy zero
  // is not a meaningful review window and must keep showing the default.
  const sla = exam.review_sla_days || 3;

  return (
    <article className="ft-card">
      <div className="ft-title">
        {exam.title || exam.code}
        {retake ? <> <span className="av-badge av-badge-warning">Test lại</span></> : null}
      </div>
      <p className="ft-muted" style={{ margin: '6px 0 12px' }}>
        {retake
          ? 'Bài test lại — chỉ làm kĩ năng được giao, có hẹn giờ, web tự thu bài khi hết giờ.'
          : `Listening → Reading → Writing, giám thị mở lần lượt từng phần · Trả kết quả trong ~${sla} ngày.`}
      </p>
      <ExamAction exam={exam} />
    </article>
  );
}

export function FullTestBehavior() {
  const { status, user } = useAuth();
  const requestKey = status === 'signed-in' && user?.id ? user.id : null;
  const [examState, setExamState] = useState<KeyedState<MockExamSummary[]> | null>(null);
  const [errorState, setErrorState] = useState<KeyedState<string> | null>(null);

  const exams = examState?.key === requestKey ? examState.value : null;
  const error = errorState?.key === requestKey ? errorState.value : null;

  useEffect(() => {
    if (status === 'signed-out') {
      setExamState(null);
      setErrorState(null);
      window.location.replace('/login.html');
    }
  }, [status]);

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();
    let disposed = false;
    setExamState(null);
    setErrorState(null);

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (full test)',
      );
      if (!ready || disposed) {
        if (!disposed) setErrorState({
          key: requestKey,
          value: 'Không tải được thành phần kết nối. Hãy tải lại trang.',
        });
        return;
      }

      try {
        const payload = await window.api.getWith<MockExamListPayload>(
          '/api/mock-exams',
          undefined,
          { signal: controller.signal },
        );
        if (!disposed) {
          setExamState({
            key: requestKey,
            value: Array.isArray(payload?.exams) ? payload.exams : [],
          });
        }
      } catch (caught: unknown) {
        if (!disposed && !(caught instanceof DOMException && caught.name === 'AbortError')) {
          setErrorState({
            key: requestKey,
            value: `Không tải được danh sách: ${messageOf(caught)}`,
          });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey]);

  if (error) {
    return <div className="ft-card" style={{ textAlign: 'center', color: 'var(--av-error)' }}>{error}</div>;
  }
  if (!exams) {
    return <div className="ft-muted" style={{ textAlign: 'center', padding: '40px 0' }}>Đang tải…</div>;
  }
  if (!exams.length) {
    return (
      <div className="ft-card" style={{ textAlign: 'center' }}>
        <p className="ft-muted">Hiện chưa có kỳ thi nào được mở. Quay lại khi giám khảo mở kỳ nhé.</p>
      </div>
    );
  }

  return <div>{exams.map((exam) => <ExamCard exam={exam} key={exam.id} />)}</div>;
}
