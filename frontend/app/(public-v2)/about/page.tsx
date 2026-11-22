import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui';
import { PUBLIC_HREF } from '@/components/ui/shell/public-links';

import { LEGAL_ROBOTS, PLACEHOLDER } from '../legal-content';
import { LegalPage } from '../legal-page';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: 'Giới thiệu — Aver Learning',
  description: 'Aver Learning là nơi học tiếng Anh và IELTS từ đầu tới nâng cao theo một lộ trình thống nhất.',
  alternates: { canonical: '/about' },
  robots: LEGAL_ROBOTS,
};

/** Hand-drawn sentence diagram, no image (PhapLy.dc.html §3, GrammarWikiMinhHoa). */
function SentenceDiagram() {
  const parts = [['s', 'Practice'], ['v', 'makes'], ['o', 'progress']] as const;
  return (
    <figure className={styles.diagram}>
      <p className={styles.diagramSentence} lang="en">
        {parts.map(([role, word]) => (
          <span key={role} className={role === 'v' ? styles.diagramVerb : undefined}>
            <span className={styles.diagramRole} aria-hidden="true">{role}</span>
            {word}
          </span>
        ))}
      </p>
      <figcaption>Mỗi phần của câu một kiểu nét: cách Aver Learning giảng ngữ pháp.</figcaption>
    </figure>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.aboutSection} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div className={styles.aboutBody}>{children}</div>
    </section>
  );
}

// PhapLy.dc.html §3. No figures, biographies or testimonials until there is a
// real source (sheet note); the team and the authoring steps stay XXX.
export default function AboutPage() {
  return (
    <LegalPage
      title="Giới thiệu"
      lead="Aver Learning là nơi học tiếng Anh và IELTS từ đầu tới nâng cao theo một lộ trình thống nhất."
      aside={<SentenceDiagram />}
    >
      <Section id="la-gi" title="Aver Learning là gì">
        <p>
          Bạn học theo khoá. Khoá online đăng ký trên web, dự kiến sáu khoá: Khoá Ngữ pháp nền tảng, Khoá Listening for IELTS,
          Khoá Reading for IELTS, Khoá Writing for IELTS, Khoá Speaking for IELTS, Khoá Vocabulary Skills + Ideas for IELTS;
          mỗi khoá có học phí, thời hạn truy cập và số lượt chấm AI đi kèm. Học viên lớp offline vào khoá của lớp (Course 1–5)
          bằng mã kích hoạt do admin cấp.
        </p>
      </Section>

      <Section id="bien-soan" title="Cách biên soạn bài giảng">
        <p>Mỗi bài giảng được biên soạn kỹ trước khi đưa vào lộ trình. Quy trình cụ thể do đội nội dung cung cấp.</p>
        <ol className={styles.steps}>
          {[1, 2, 3].map((n) => (
            <li key={n}><span className={styles.stepN}>{n}</span><span><strong>Bước {n}:</strong> {PLACEHOLDER}</span></li>
          ))}
        </ol>
      </Section>

      <Section id="ai-cham" title="AI chấm bài thế nào">
        <p>
          AI đọc bài của bạn theo các tiêu chí của kỳ thi và chỉ ra đúng câu, đúng đoạn làm cơ sở cho từng nhận xét, để bạn tự
          kiểm lại được.
        </p>
        <p>
          <strong>AI không thay giáo viên.</strong> Điểm AI chỉ là ước lượng để bạn luyện tập, có thể chưa chính xác, và không
          phải điểm thi thật. Khoá online: AI chấm và trả kết quả ngay. Học viên lớp offline: bài Writing do AI chấm, giáo viên
          duyệt rồi mới trả; bài Speaking AI chấm và trả ngay. Khi cần ý kiến của giáo viên: <strong>{PLACEHOLDER}</strong>.
        </p>
        <figure className={styles.example}>
          <figcaption className={styles.exampleLabel}>Ví dụ minh hoạ cách AI nêu dẫn chứng</figcaption>
          <p className={styles.exampleSentence} lang="en">
            Technology make<sup>1</sup> some jobs disappear, but it also creates many new job<sup>2</sup>.
          </p>
          <ol className={styles.exampleNotes}>
            <li>Câu 1, động từ <em lang="en">make</em> chưa chia theo chủ ngữ số ít. Tiêu chí: Grammatical Range and Accuracy.</li>
            <li>Câu 1, <em lang="en">many new job</em> thiếu số nhiều. Tiêu chí: Grammatical Range and Accuracy.</li>
          </ol>
        </figure>
      </Section>

      <Section id="doi-ngu" title="Người làm ra Aver Learning">
        <p>Thông tin về đội ngũ sẽ do chủ dự án cung cấp.</p>
        <dl className={styles.team}>
          {[1, 2, 3].map((n) => (
            <div key={n}><dt>{PLACEHOLDER}</dt><dd>Vai trò: {PLACEHOLDER}</dd></div>
          ))}
        </dl>
      </Section>

      <p className={styles.actions}>
        <Button href={PUBLIC_HREF.library} variant="secondary">Xem Thư viện miễn phí</Button>
        <Button href={PUBLIC_HREF.courses} variant="primary">Xem các khoá</Button>
      </p>
    </LegalPage>
  );
}
