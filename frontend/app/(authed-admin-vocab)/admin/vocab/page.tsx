import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

export const metadata: Metadata = {
  title: 'Vocabulary workspace · Admin',
  description: 'Điều phối nội dung, bài luyện và tín hiệu vận hành Vocabulary.',
  robots: { index: false, follow: false },
};

const destinations = [
  { eyebrow: 'Sức khoẻ hệ thống', title: 'Vocab + Flashcards Stats', description: 'Theo dõi quy mô ngân hàng, false-positive, feature flag và sức khoẻ SRS.', detail: 'Bank · SRS · Engagement', href: '/admin/vocab/stats', status: 'LIVE', featured: true },
  { eyebrow: 'Tín hiệu người học', title: 'Kết quả Quick-Check', description: 'Quan sát số phiên, độ chính xác và những từ dễ sai theo từng bộ.', detail: 'Attempts · Accuracy · Difficult words', href: '/pages/admin/vocab/quiz-analytics.html', status: 'LIVE' },
  { eyebrow: 'Ngân hàng nội dung', title: 'Nội dung từ vựng', description: 'Tìm kiếm, nhập, sửa và quản lý vòng đời các thẻ từ vựng.', detail: 'Import · Edit · Archive', href: '/pages/admin/vocab/content.html', status: 'LEGACY CONSOLE' },
  { eyebrow: 'Cấu trúc chương trình', title: 'Chủ đề', description: 'Quản lý topic và liên kết từ vựng với ngân hàng câu hỏi.', detail: 'Topics · Cards · Banks', href: '/pages/admin/vocab/topics.html', status: 'LEGACY CONSOLE' },
  { eyebrow: 'Kiểm duyệt cá nhân hoá', title: 'D1 Curation', description: 'Rà soát câu fill-blank, ngữ cảnh và nguồn sinh trước khi phát hành.', detail: 'Review · Edit · Soft-delete', href: '/pages/admin/vocab/d1-curation.html', status: 'LIVE' },
  { eyebrow: 'Chuẩn hoá ngôn ngữ', title: 'Lemma Overrides', description: 'Sửa mapping lemma cho idiom, proper noun và trường hợp spaCy nhận sai.', detail: 'Search · Override · Audit', href: '/pages/admin/vocab/lemmas.html', status: 'LIVE' },
  { eyebrow: 'Bài luyện D1', title: 'Exercises pool', description: 'Điều phối hàng đợi draft, publish/reject và batch generation.', detail: 'Draft · Publish · Generate', href: '/pages/admin/vocab/exercises.html', status: 'LIVE' },
  { eyebrow: 'Ngân hàng kiểm tra', title: 'Quick-Check Quiz', description: 'Quản lý câu hỏi và cấu hình quiz theo topic hoặc skill area.', detail: 'Banks · Questions · Import', href: '/pages/admin/vocab/quiz.html', status: 'LIVE' },
] as const;

export default function AdminVocabPage() {
  return (
    <aver-admin-chrome active="vocab">
      <AdminAccessGate>
        <main className="avv-shell">
          <header className="avv-hero">
            <div><p className="avv-eyebrow">Nội dung học tập</p><h1>Vocabulary workspace</h1><p>Điểm vào thống nhất cho kho từ, bài luyện và các tín hiệu vận hành cần admin xử lý.</p></div>
            <a className="avv-learner-link" href="/vocabulary/hub"><span>Xem phía học viên</span><span aria-hidden="true">↗</span></a>
          </header>
          <section aria-labelledby="avv-workspaces-title">
            <div className="avv-section-head"><div><p className="avv-eyebrow">Công cụ vận hành</p><h2 id="avv-workspaces-title">Chọn workspace</h2></div><p>Mỗi console giữ đúng một nhóm tác vụ để giảm thao tác nhầm.</p></div>
            <div className="avv-grid">
              {destinations.map((item, index) => (
                <a className={`avv-card${'featured' in item && item.featured ? ' avv-card--featured' : ''}`} href={item.href} key={item.href}>
                  <div className="avv-card__top"><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="adm-status-pill is-live">{item.status}</span></div>
                  <div><p className="avv-card__eyebrow">{item.eyebrow}</p><h3>{item.title}</h3><p>{item.description}</p></div>
                  <footer><span>{item.detail}</span><span aria-hidden="true">→</span></footer>
                </a>
              ))}
            </div>
          </section>
        </main>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}
