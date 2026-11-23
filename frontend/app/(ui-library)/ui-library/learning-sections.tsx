// /ui-library sections for G03-T09 (UIBASE-0056 FR-005, FR-013): BandScore
// (+ CriteriaList, OverallBlock), Timer, QuestionPalette, VocabEntry,
// AnnotatedText, Figure, as drawn on ThanhPhanHocTap §1, §4 and
// ThanhPhanHocTap2 §5–8. Sample data only.
import { BandScore, Button, Figure, OverallBlock, QuestionPalette, Timer, VocabEntry } from '@/components/ui';

import { AnnotatedDemo, PaletteDemo } from './learning-demos';
import styles from './ui-library.module.css';

const CRITERIA = [
  { name: 'Task Response', band: 5.5, note: 'Chưa bàn đủ vế thứ hai của đề.' },
  { name: 'Coherence and Cohesion', band: 6, note: 'Bố cục rõ, nối ý còn lặp.' },
  { name: 'Lexical Resource', band: 6, note: 'Đủ dùng, lặp từ khoá nhiều.' },
  { name: 'Grammatical Range and Accuracy', band: 6, note: 'Có câu phức; sai hoà hợp chủ–vị.' },
];

export function BandScoreSection({ title }: { title: string }) {
  return (
    <section id="band-score" className={styles.section} aria-labelledby="band-score-h">
      <h2 id="band-score-h">{title}</h2>
      <p className={styles.demoLabel}>Cỡ lớn · có band, so với lần trước bằng chữ, bốn tiêu chí</p>
      <BandScore
        skill="Writing Task 2"
        band={6.5}
        basis="Dựa trên 1 bài, 268 từ"
        previous={{ band: 6, date: '02/11' }}
        criteria={CRITERIA}
      />
      <p className={styles.demoLabel}>Chưa đủ bài để ước lượng · không có số</p>
      <BandScore
        skill="Listening"
        state="insufficient"
        note={<>Bài luyện này: đúng 9 trên 13 câu. Band Listening cần một đề đủ 40 câu.</>}
        action={<Button variant="secondary">Làm một đề đủ</Button>}
      />
      <p className={styles.demoLabel}>Đang chấm</p>
      <BandScore skill="Speaking" state="grading" note="Thường xong sau 2 phút. Bạn có thể rời trang, kết quả sẽ báo ở mục Hôm nay." />
      <p className={styles.demoLabel}>Cỡ vừa · thẻ trong Lộ trình, Hôm nay</p>
      <div className={styles.row}>
        <BandScore size="md" skill="Writing" band={6} basis="dựa trên 3 bài" />
        <BandScore size="md" skill="Reading" state="insufficient" note="Cần một đề đủ 40 câu · bạn đã làm 2 bài ngắn" />
        <BandScore size="md" skill="Listening" band={6.5} basis="dựa trên 2 đề đủ" previous={{ band: 6.5 }} />
      </div>
      <p className={styles.demoLabel}>Cỡ dòng · trong danh sách bài đã nộp</p>
      <BandScore size="row" skill="Reading · Academic Test 1 · đủ 40 câu" band={7} basis="ước lượng từ 1 đề" />
      <p className={styles.demoLabel}>Overall · mock test được giao, đã trả đủ các phần</p>
      <OverallBlock
        skills={[{ name: 'Listening', band: 6.5 }, { name: 'Reading', band: 7 }, { name: 'Writing', band: 6 }, { name: 'Speaking', band: 6 }]}
        note={<>Mock test được giao &ldquo;Thi thử tháng 11&rdquo;, thi ngày 17/11.</>}
      />
      <p className={styles.demoLabel}>Overall · còn phần đang chấm · không có số</p>
      <OverallBlock
        skills={[{ name: 'Listening', band: 6.5 }, { name: 'Reading', band: 7 }, { name: 'Writing', band: 6 }, { name: 'Speaking', band: null }]}
        missing={['Speaking']}
        note="Overall hiện khi mọi phần của mock test đã trả điểm."
      />
    </section>
  );
}

const EXAM_MARKS = [
  { at: 300, label: '5 minutes left', announce: '5 minutes left. The test will submit automatically.' },
  { at: 0, label: 'Time is up', note: 'Your answers have been saved and submitted.' },
];
const RECORD_MARKS = [{ at: 105, label: 'Còn 15 giây', note: 'Tới 2:00 sẽ tự dừng và lưu bài nói của bạn.' }];

export function TimerSection({ title }: { title: string }) {
  return (
    <section id="timer" className={styles.section} aria-labelledby="timer-h">
      <h2 id="timer-h">{title}</h2>
      <p className={styles.demoLabel}>Chế độ thi · nhãn tiếng Anh · bình thường, còn 5 phút, hết giờ</p>
      <div className={styles.row}>
        <Timer lang="en" label="Time remaining" seconds={1930} thresholds={EXAM_MARKS} />
        <Timer lang="en" label="Time remaining" seconds={299} thresholds={EXAM_MARKS} />
        <Timer lang="en" label="Time remaining" seconds={0} thresholds={EXAM_MARKS} />
      </div>
      <p className={styles.demoLabel}>Chế độ học · Speaking · đếm ngược chuẩn bị, đếm lên khi ghi âm, sắp hết</p>
      <div className={styles.row}>
        <Timer label="Part 2 · thời gian chuẩn bị" seconds={42} note="Hết giờ sẽ tự bắt đầu ghi âm." />
        <Timer mode="countup" label="Đang ghi âm" seconds={65} max={120} thresholds={RECORD_MARKS} />
        <Timer mode="countup" label="Đang ghi âm" seconds={105} max={120} thresholds={RECORD_MARKS} />
      </div>
    </section>
  );
}

const GRADED_WRONG = new Set([3, 13]);
const GRADED_BLANK = new Set([5, 9]);

export function QuestionPaletteSection({ title }: { title: string }) {
  return (
    <section id="question-palette" className={styles.section} aria-labelledby="question-palette-h">
      <h2 id="question-palette-h">{title}</h2>
      <p className={styles.demoLabel}>Phòng thi · nhãn tiếng Anh · bấm một số để chuyển câu</p>
      <PaletteDemo lang="en" />
      <p className={styles.demoLabel}>Chế độ học · đang làm</p>
      <PaletteDemo lang="vi" />
      <p className={styles.demoLabel}>Chế độ học · sau khi chấm</p>
      <QuestionPalette
        title="Câu 1–13"
        items={Array.from({ length: 13 }, (_, i) => {
          const num = i + 1;
          return { num, state: GRADED_WRONG.has(num) ? 'wrong' : GRADED_BLANK.has(num) ? 'blank' : 'correct' };
        })}
      />
    </section>
  );
}

export function VocabEntrySection({ title }: { title: string }) {
  return (
    <section id="vocab-entry" className={styles.section} aria-labelledby="vocab-entry-h">
      <h2 id="vocab-entry-h">{title}</h2>
      <p className={styles.demoLabel}>Đầy đủ · Sổ từ, Thư viện, sau bài đọc</p>
      <VocabEntry
        headword="affordable"
        ipa="əˈfɔːdəbl"
        pos="tính từ"
        defEn="cheap enough for most people to pay for"
        defVi="vừa túi tiền, giá phải chăng"
        example={<>The city plans to make bus tickets more <strong>affordable</strong> for students.</>}
        collocations={['affordable housing', 'remain affordable', 'make something affordable']}
        actions={<Button variant="secondary">Lưu vào sổ từ</Button>}
      />
      <p className={styles.demoLabel}>Thu gọn · nổi cạnh từ đang chọn trong bài đọc</p>
      <VocabEntry
        variant="popover"
        headword="congestion"
        ipa="kənˈdʒestʃən"
        pos="danh từ"
        defVi="tình trạng ùn tắc giao thông"
        actions={<><Button variant="secondary" size="sm">Lưu vào sổ từ</Button><Button variant="text" size="sm">Xem đủ mục từ</Button></>}
      />
    </section>
  );
}

export function AnnotatedTextSection({ title }: { title: string }) {
  return (
    <section id="annotated-text" className={styles.section} aria-labelledby="annotated-text-h">
      <h2 id="annotated-text-h">{title}</h2>
      <p className={styles.demoLabel}>Bài viết · bấm số ở lề để chọn chú thích · bốn kiểu gạch khác nhau</p>
      <AnnotatedDemo />
    </section>
  );
}

export function FigureSection({ title }: { title: string }) {
  return (
    <section id="figure" className={styles.section} aria-labelledby="figure-h">
      <h2 id="figure-h">{title}</h2>
      <p className={styles.demoLabel}>Sơ đồ quy trình đơn giản</p>
      <Figure
        number="Hình 9.1"
        caption="Mở bài Task 2 chỉ cần ba việc; bước 3 là bước người học hay bỏ sót."
        alt="Ba bước mở bài Task 2: viết lại đề, nêu quan điểm, báo trước hai ý của thân bài."
        source="Aver Learning biên soạn."
      >
        <svg viewBox="0 0 600 120" fill="none" stroke="currentColor" strokeWidth={1}>
          <rect x="1" y="30" width="170" height="60" />
          <rect x="215" y="30" width="170" height="60" />
          <rect x="429" y="30" width="170" height="60" />
          <path d="M171 60h44M385 60h44" />
          <path d="M207 55l8 5-8 5M421 55l8 5-8 5" />
          <g fill="currentColor" stroke="none" fontSize="14">
            <text x="16" y="56">1 Viết lại đề</text>
            <text x="16" y="76">bằng lời của bạn</text>
            <text x="230" y="56">2 Nêu quan điểm</text>
            <text x="230" y="76">trong một câu</text>
            <text x="444" y="56">3 Báo trước hai ý</text>
            <text x="444" y="76">của thân bài</text>
          </g>
        </svg>
      </Figure>
      <p className={styles.demoLabel}>Ô chờ · minh hoạ chưa có</p>
      <Figure
        number="Hình 22.3"
        caption="Chú thích viết trước, hình vẽ sau."
        alt="quy trình tái chế chai nhựa, 5 bước có mũi tên, cho bài Task 1 số 22"
        source="XXX"
      />
    </section>
  );
}
