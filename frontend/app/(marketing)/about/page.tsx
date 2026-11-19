import type { Metadata } from 'next';
import Link from 'next/link';

import { LEGAL_ROBOTS, PLACEHOLDER } from '../legal-content';
import { LegalShell } from '../legal-shell';

export const metadata: Metadata = {
  title: 'Giới thiệu — Aver Learning',
  description: 'Aver Learning là nơi học tiếng Anh và IELTS từ đầu tới nâng cao theo một lộ trình thống nhất.',
  alternates: { canonical: '/about' },
  robots: LEGAL_ROBOTS,
};

export default function AboutPage() {
  return (
    <LegalShell title="Giới thiệu">
      <h1 className="lg-h1">Giới thiệu</h1>
      <p className="lg-lead">Aver Learning là nơi học tiếng Anh và IELTS từ đầu tới nâng cao theo một lộ trình thống nhất.</p>

      <section className="lg-article" aria-labelledby="la-gi">
        <h2 id="la-gi">Aver Learning là gì</h2>
        <p>
          Bạn học theo khoá. Khoá online đăng ký trên web, dự kiến sáu khoá: Khoá Ngữ pháp nền tảng, Khoá Listening for IELTS,
          Khoá Reading for IELTS, Khoá Writing for IELTS, Khoá Speaking for IELTS, Khoá Vocabulary Skills + Ideas for IELTS;
          mỗi khoá có học phí, thời hạn truy cập và số lượt chấm AI đi kèm. Học viên lớp offline vào khoá của lớp (Course 1–5)
          bằng mã kích hoạt do admin cấp.
        </p>
      </section>

      <section className="lg-article" aria-labelledby="bien-soan">
        <h2 id="bien-soan">Cách biên soạn bài giảng</h2>
        <p>Mỗi bài giảng được biên soạn kỹ trước khi đưa vào lộ trình. Quy trình cụ thể do đội nội dung cung cấp.</p>
        <ol className="lg-steps">
          <li>Bước 1: {PLACEHOLDER}</li>
          <li>Bước 2: {PLACEHOLDER}</li>
          <li>Bước 3: {PLACEHOLDER}</li>
        </ol>
      </section>

      <section className="lg-article" aria-labelledby="ai-cham">
        <h2 id="ai-cham">AI chấm bài thế nào</h2>
        <p>
          AI đọc bài của bạn theo các tiêu chí của kỳ thi và chỉ ra đúng câu, đúng đoạn làm cơ sở cho từng nhận xét, để bạn tự
          kiểm lại được. AI không thay giáo viên. Điểm AI chỉ là ước lượng để bạn luyện tập, có thể chưa chính xác, và không
          phải điểm thi thật.
        </p>
        <p>
          Khoá online: AI chấm và trả kết quả ngay. Học viên lớp offline: bài Writing do AI chấm, giáo viên duyệt rồi mới trả;
          bài Speaking AI chấm và trả ngay. Khi cần ý kiến của giáo viên: {PLACEHOLDER}.
        </p>
      </section>

      <section className="lg-article" aria-labelledby="doi-ngu">
        <h2 id="doi-ngu">Người làm ra Aver Learning</h2>
        <p>Thông tin về đội ngũ sẽ do chủ dự án cung cấp. {PLACEHOLDER}</p>
      </section>

      <p className="lg-actions">
        <Link href="/grammar">Xem Grammar Wiki miễn phí</Link>
      </p>
    </LegalShell>
  );
}
