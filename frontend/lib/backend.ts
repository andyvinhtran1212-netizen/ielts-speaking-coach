// Tầng gọi backend dùng chung cho MỌI route Next đọc nội dung công khai
// (Phase 3 trở đi). Trước file này, `lib/grammar-api.ts` tự giữ một bản
// resolve-base + fetch + cacheLife riêng; chép bản đó sang từng route mới là
// cách chắc chắn nhất để 125 trang có 125 hành vi lỗi khác nhau.
//
// Gate C (02/08) chốt "làm tiếp toàn bộ" trong khi Gate D — vốn đòi primitive
// ổn định qua ≥3 implementation — chưa mở. Đây là cách bù: dựng primitive
// TRƯỚC route đầu tiên của Phase 3, không phải sau route thứ mười.
//
// `server-only`: module này không được lọt vào bundle client. Nó không giữ bí
// mật nào (chỉ gọi GET công khai, không cookie/Authorization — ADR-004) nhưng
// ranh giới đó chính là hợp đồng (B25).
import 'server-only';

import { cacheLife } from 'next/cache';

/**
 * Base URL của backend, cùng quy tắc với bộ sinh runtime-config (ADR-006):
 * build production → API production · Vercel env khác → STAGING · máy local →
 * localhost. `AVER_API_BASE` ghi đè, y hệt bộ sinh.
 */
export const API_BASE =
  process.env.AVER_API_BASE ||
  (process.env.VERCEL_ENV === 'production'
    ? 'https://ielts-speaking-coach-production.up.railway.app'
    : process.env.VERCEL_ENV
      ? 'https://ielts-speaking-coach-staging.up.railway.app'
      : 'http://localhost:8000');

/** Ngân sách abort của ADR-008 — một request treo không được giữ cả trang. */
export const ABORT_MS = 5000;

/** TTL của ADR-008 cho nội dung công khai: 1h stale/revalidate, hết hạn 1 ngày. */
export const PUBLIC_CONTENT_LIFE = { stale: 3600, revalidate: 3600, expire: 86400 };

/**
 * GET một endpoint nội dung công khai.
 *
 * Ngữ nghĩa lỗi CỐ Ý tách đôi, vì hai ca này khác nhau về hậu quả:
 *   · **404 → `null`**: nội dung không tồn tại. Route gọi `notFound()`, người
 *     đọc thấy trang 404 kèm `noindex`.
 *   · **Lỗi khác → ném**: backend hỏng/timeout. Ném để error boundary của route
 *     xử lý fail-closed (B17/B12); cache theo request vẫn có thể phục vụ bản
 *     tốt trước đó trong cửa sổ stale. **Không** nuốt lỗi thành `null` — trang
 *     404 giả khi backend sập là kiểu nói dối tệ nhất với người đọc và với
 *     chính bảng đo của mình.
 */
export async function getPublicJson<T = unknown>(path: string): Promise<T | null> {
  'use cache';
  cacheLife(PUBLIC_CONTENT_LIFE);

  const res = await fetch(`${API_BASE}${path}`, {
    signal: AbortSignal.timeout(ABORT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`backend ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}
