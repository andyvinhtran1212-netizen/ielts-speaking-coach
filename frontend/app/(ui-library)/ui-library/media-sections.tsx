// /ui-library sections for G03-T10 (UIBASE-0056 #31, #32): AudioPlayer and
// VideoFrame in every state drawn on ThanhPhanHocTap §2–3. Sample data only;
// the YouTube frame is given a non no-cookie embed URL, so it shows the
// "Chưa nhúng được video này" state and never a live iframe: the screenshot
// does not depend on the network.
import { AudioPlayer, VideoFrame } from '@/components/ui';

import { AudioPlayerDemo, VideoFrameDemo } from './media-demos';
import styles from './ui-library.module.css';

const TRACK = 'Booking a room at the sports centre';

export function AudioPlayerSection({ title }: { title: string }) {
  return (
    <section id="audio-player" className={styles.section} aria-labelledby="audio-player-h">
      <h2 id="audio-player-h">{title}</h2>
      <AudioPlayerDemo />
      <div className={styles.mediaGrid}>
        <div className={styles.stack}>
          <p className={styles.rowNote}>Đang tải</p>
          <AudioPlayer state="loading" title={TRACK} current={0} duration={0} />
          <p className={styles.rowNote}>Lỗi · câu trả lời vẫn còn</p>
          <AudioPlayer state="error" title={TRACK} current={72} duration={222} stoppedAt={72} />
          <p className={styles.rowNote}>Chế độ thi · đang phát</p>
          <AudioPlayer state="playing" mode="exam" title={TRACK} current={72} duration={222} />
        </div>
        <div className={styles.stack}>
          <p className={styles.rowNote}>Chỉ nghe một lần · trước khi phát</p>
          <AudioPlayer variant="once" state="ready" title={TRACK} current={0} duration={222} />
          <p className={styles.rowNote}>Chỉ nghe một lần · đang phát</p>
          <AudioPlayer variant="once" state="playing" title={TRACK} current={72} duration={222} />
          <p className={styles.rowNote}>Chỉ nghe một lần · đã nghe, đã khoá</p>
          <AudioPlayer variant="once" state="locked" title={TRACK} current={222} duration={222} />
        </div>
      </div>
      <p className={styles.note}>
        Bài luyện: tua 5 giây, tốc độ 0,75× đến 1,5×, lặp đoạn A–B. Chế độ thi và bài nghe một lần không có tạm dừng, tua, tốc độ hay A–B.
      </p>
    </section>
  );
}

export function VideoFrameSection({ title }: { title: string }) {
  return (
    <section id="video-frame" className={styles.section} aria-labelledby="video-frame-h">
      <h2 id="video-frame-h">{title}</h2>
      <div className={styles.mediaGrid}>
        <div>
          <p className={styles.rowNote}>Nguồn YouTube · link nhúng chưa dùng được</p>
          <VideoFrame
            source="youtube"
            state="idle"
            title="Bài 14 · Hoà hợp chủ ngữ và động từ"
            meta="12:40 · phụ đề tiếng Việt do kênh cung cấp"
            embedUrl="https://www.youtube.com/embed/M7lc1UVf-VE"
            watchUrl="https://www.youtube.com/watch?v=M7lc1UVf-VE"
          />
        </div>
        <div>
          <p className={styles.rowNote}>Máy chủ video riêng · bấm thử được</p>
          <VideoFrameDemo />
        </div>
      </div>
      <div className={styles.progressGrid}>
        <div>
          <p className={styles.rowNote}>Đang tải</p>
          <VideoFrame source="self" state="loading" title="Bài 15 · Mệnh đề quan hệ" />
        </div>
        <div>
          <p className={styles.rowNote}>Lỗi</p>
          <VideoFrame source="self" state="error" title="Bài 15 · Mệnh đề quan hệ" resumeAt={372} transcriptHref="#video-frame" />
        </div>
        <div>
          <p className={styles.rowNote}>Cần khoá học</p>
          <VideoFrame
            source="self"
            state="locked"
            title="Bài 22 · Mô tả quy trình Task 1"
            lockedHref="#video-frame"
            lockedNote="Bạn vẫn xem được 2 phút đầu và đọc bản chữ tóm tắt."
          />
        </div>
      </div>
      <p className={styles.note}>Mọi trạng thái nói bằng chữ trong vùng video. Video không tự phát.</p>
    </section>
  );
}
