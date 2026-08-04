// Bài tập theo buổi — trang làm bài của học viên.
//
// Viết thẳng bằng Next thay vì thêm một trang HTML legacy: cổng
// `legacy-freeze.yml` chặn đúng việc đó, và bề mặt legacy đang ~129 trang.
// Danh sách ngoại lệ hiện TRỐNG — xin ngoại lệ đầu tiên cho một trang vừa viết
// hôm nay, chỉ vì port tốn công hơn, là tự cấp phép.
//
// Khung TĨNH hoàn toàn: không có lượt đọc nào phía máy chủ, nên bearer token
// không đi qua ranh giới RSC (ADR-003 §3). Mọi dữ liệu riêng tư tới bằng
// `window.api` phía client, đúng như đường quiz đang chạy.
import type { Metadata } from 'next';

import { CourseShell } from './page-shell';
import { CourseBehavior } from './course-behavior';

export const metadata: Metadata = {
  title: 'Bài tập theo buổi — AverLearning',
  // Route riêng tư (khách chưa đăng nhập bị đẩy về /login) — không cho lập chỉ mục.
  robots: { index: false, follow: false },
};

export default function CourseExercisesPage() {
  return (
    <>
      <CourseShell />
      <CourseBehavior />
    </>
  );
}
