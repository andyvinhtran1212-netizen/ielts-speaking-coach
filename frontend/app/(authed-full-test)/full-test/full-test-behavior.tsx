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

function ExamAction({ exam }: { exam: MockExamSummary }) {
  if (exam.blocked_by_sitting_id) {
    return (
      <div className="ft-action is-blocked">
        <p><strong>Đang có một lượt thi khác.</strong><span>Hoàn thành lượt đó trước khi mở kỳ thi này.</span></p>
        <a
          className="av-button av-button-secondary"
          href={`/mock-exam?sitting=${encodeURIComponent(exam.blocked_by_sitting_id)}`}
        >
          Quay lại bài đang thi <span aria-hidden="true">→</span>
        </a>
      </div>
    );
  }

  const target = exam.my_sitting_id
    ? `/mock-exam?sitting=${encodeURIComponent(exam.my_sitting_id)}`
    : `/mock-exam?code=${encodeURIComponent(exam.code)}`;
  return (
    <a className="av-button av-button-primary" href={target}>
      {exam.my_sitting_id ? 'Tiếp tục bài đang làm' : 'Bắt đầu kỳ thi'} <span aria-hidden="true">→</span>
    </a>
  );
}

function ExamCard({ exam }: { exam: MockExamSummary }) {
  const retake = exam.exam_mode === 'retake';
  // Preserve the legacy `review_sla_days || 3` display contract. A falsy zero
  // is not a meaningful review window and must keep showing the default.
  const sla = exam.review_sla_days || 3;

  return (
    <article className={`ft-card${exam.my_sitting_id ? ' is-active' : ''}${exam.blocked_by_sitting_id ? ' is-blocked' : ''}`}>
      <div className="ft-card__head">
        <span className={`ft-kind${retake ? ' is-retake' : ''}`}>{retake ? 'Bài thi lại' : 'Full test'}</span>
        <span className="ft-code">{exam.code}</span>
      </div>
      <h2 className="ft-title">{exam.title || exam.code}</h2>
      <p className="ft-description">
        {retake
          ? 'Chỉ làm kỹ năng được giao. Đồng hồ vẫn chạy độc lập và hệ thống tự thu bài khi hết giờ.'
          : 'Ba phần thi viết được mở lần lượt; Speaking được giáo viên tổ chức và chấm riêng.'}
      </p>
      {!retake ? (
        <ol className="ft-timeline" aria-label="Trình tự kỳ thi">
          <li><span>L</span><div><strong>Listening</strong><small>Nghe và nộp bài</small></div></li>
          <li><span>R</span><div><strong>Reading</strong><small>Đọc hiểu</small></div></li>
          <li><span>W</span><div><strong>Writing</strong><small>Viết học thuật</small></div></li>
          <li><span>S</span><div><strong>Speaking</strong><small>Thi với giáo viên</small></div></li>
        </ol>
      ) : null}
      <div className="ft-review-note"><span>Thời gian trả kết quả</span><strong>Khoảng {sla} ngày</strong></div>
      <ExamAction exam={exam} />
    </article>
  );
}

export function FullTestBehavior() {
  const { status, user } = useAuth();
  const requestKey = status === 'signed-in' && user?.id ? user.id : null;
  const [examState, setExamState] = useState<KeyedState<MockExamSummary[]> | null>(null);
  const [errorState, setErrorState] = useState<KeyedState<string> | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  const exams = examState?.key === requestKey ? examState.value : null;
  const error = errorState?.key === requestKey ? errorState.value : null;

  useEffect(() => {
    if (status === 'signed-out') {
      setExamState(null);
      setErrorState(null);
      window.location.replace('/login');
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
            value: 'Không tải được danh sách kỳ thi. Vui lòng thử lại.',
          });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey, reloadVersion]);

  if (error) {
    return (
      <div className="ft-state is-error" role="alert">
        <div><strong>Chưa tải được kỳ thi</strong><p>{error}</p></div>
        <button type="button" onClick={() => setReloadVersion((value) => value + 1)}>Thử lại</button>
      </div>
    );
  }
  if (!exams) {
    return <div className="ft-state" role="status"><div><strong>Đang chuẩn bị danh sách kỳ thi</strong><p>Đang kiểm tra lượt thi và quyền truy cập của bạn…</p></div></div>;
  }
  if (!exams.length) {
    return (
      <div className="ft-state">
        <div><strong>Hiện chưa có kỳ thi nào được mở</strong><p>Quay lại khi giám khảo công bố lịch thi mới.</p></div>
      </div>
    );
  }

  const ordered = [...exams].sort((first, second) => Number(Boolean(second.my_sitting_id)) - Number(Boolean(first.my_sitting_id)));
  return (
    <section className="ft-library" aria-labelledby="ft-library-title">
      <div className="ft-library__head"><div><p className="ft-eyebrow">Kỳ thi của bạn</p><h2 id="ft-library-title">Chọn kỳ thi để tiếp tục</h2></div><span>{exams.length} kỳ thi</span></div>
      <div className="ft-list">{ordered.map((exam) => <ExamCard exam={exam} key={exam.id} />)}</div>
    </section>
  );
}
