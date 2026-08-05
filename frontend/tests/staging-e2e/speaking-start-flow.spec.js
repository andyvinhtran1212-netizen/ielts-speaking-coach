// Luồng NGHIỆP VỤ của `/speaking` trên bản Next: bấm nút → tạo đúng phiên →
// điều hướng sang trang luyện tập.
//
// VÌ SAO CẦN, DÙ CỔNG PARITY ĐÃ XANH TUYỆT ĐỐI:
// G1 so CHỮ, LINK, KHỐI ở TRẠNG THÁI TĨNH. Nó không bấm gì, nên nó không thể
// phân biệt "nút có nhãn đúng" với "nút làm đúng việc". Bốn PR port `/speaking`
// vừa rồi để lọt đúng BA lỗi thuộc loại đó — build xanh, test xanh, trang mở
// được, nút không làm gì:
//   · gắn listener vào 6 id không tồn tại (vỏ bỏ handler nội tuyến, id chưa có);
//   · thiếu `cue-card-detector.js` ⇒ mọi đường "câu hỏi tự nhập" ném TypeError;
//   · biểu đồ không chờ Chart.js ⇒ mất hẳn khi CDN chậm.
// Cả ba chỉ bị bắt nhờ chốt chặn viết riêng, KHÔNG phải nhờ cổng. `/home` chỉ
// ĐỌC nên rủi ro thấp; `/speaking` TẠO DỮ LIỆU THẬT, nên trước khi chuyển học
// viên sang route mới phải có ít nhất một phép thử đi hết đường.
//
// VÌ SAO Ở STAGING CHỨ KHÔNG PHẢI TRONG CỔNG PARITY: bộ so parity CHỈ ĐỌC — nó
// chặn mọi phương thức ghi, có chủ ý (từng suýt ghi vào bảng analytics production
// mà nó đang đo). Test này PHẢI ghi, nên nó thuộc về staging: backend + Supabase
// riêng, danh tính seed sẵn, `GRADING_PROVIDER_MODE=fixture`.
//
// ĐIỀU KIỆN CHẠY: nhánh `staging` phải có mã Next của trang này. Cập nhật bằng
// `git push origin origin/main:refs/heads/staging --force` (người dùng chạy).
// Nếu route chưa có, test SKIP kèm lý do rõ ràng thay vì đỏ nhập nhằng — một
// test đỏ vì môi trường chưa đồng bộ sẽ bị học cách phớt lờ.
const { test, expect } = require('@playwright/test');
const {
  primeBypassCookie, identityEmail, STAGING_API, STAGING_SUPABASE, STAGING_ANON,
} = require('./helpers');

const STORAGE_KEY = `sb-${new URL(STAGING_SUPABASE).hostname.split('.')[0]}-auth-token`;
const ROUTE = '/speaking-preview';

async function signInSession(request, role) {
  const password = process.env.E2E_PASSWORD || '';
  if (!password) throw new Error('E2E_PASSWORD is required (must match staging_seed.py).');
  const res = await request.post(`${STAGING_SUPABASE}/auth/v1/token?grant_type=password`, {
    headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
    data: { email: identityEmail(role), password },
  });
  if (res.status() !== 200) {
    throw new Error(`sign-in failed for ${role}: HTTP ${res.status()} ${await res.text()}`);
  }
  const session = await res.json();
  if (!session.expires_at) {
    session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
  }
  return session;
}

/** Tiêm phiên vào trình duyệt TRƯỚC khi điều hướng — giống hệt cách authed-G1 làm. */
async function asStudent(context, request, baseURL) {
  await primeBypassCookie(context, baseURL);
  const session = await signInSession(request, 'student');
  await context.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, v); } catch (_) {}
  }, [STORAGE_KEY, JSON.stringify(session)]);
  return session;
}

test.describe('luồng bắt đầu luyện tập trên /speaking (bản Next)', () => {
  /**
   * Phiên do test tạo ra.
   *
   * KHÔNG DỌN ĐƯỢC — backend không có `DELETE /sessions/{id}` (đã kiểm:
   * `routers/sessions.py` chỉ khai GET/POST/PATCH). Bản đầu của tệp này gọi
   * DELETE trong `afterAll` và bọc `.catch()`, tức là một hàm dọn dẹp KHÔNG
   * BAO GIỜ dọn được gì mà vẫn trông như có. Thà nói thẳng.
   *
   * Chấp nhận được: staging là môi trường seed, và `gate-a-flows` cũng để lại
   * phiên của nó. Khi cần làm sạch thì chạy `backend/scripts/staging_seed.py
   * --cleanup`.
   */
  const created = [];

  test.afterAll(() => {
    if (created.length) {
      console.log(`[speaking-flow] để lại ${created.length} phiên trên staging: `
        + `${created.join(', ')} — không có endpoint xoá; dùng staging_seed.py --cleanup`);
    }
  });

  test('route Next có mặt trên staging (nếu không, các test dưới SKIP)', async ({ page, context, request, baseURL }) => {
    await asStudent(context, request, baseURL);
    const res = await page.goto(ROUTE);
    test.skip(!res || res.status() >= 400,
      `${ROUTE} chưa có trên staging — đồng bộ nhánh staging từ main rồi chạy lại`);
    // Phải là route NEXT, không phải tệp legacy phục vụ trùng đường.
    const html = await page.content();
    expect(html, 'phải là route Next, không phải tệp legacy').toContain('__next_f');
  });

  test('bấm "Bắt đầu luyện tập" theo chủ đề → tạo phiên ĐÚNG và điều hướng', async ({ page, context, request, baseURL }) => {
    const session = await asStudent(context, request, baseURL);
    const res = await page.goto(ROUTE);
    test.skip(!res || res.status() >= 400, `${ROUTE} chưa có trên staging`);

    // Bắt request tạo phiên để kiểm THÂN gửi lên — nhãn nút đúng mà gửi sai
    // `mode`/`part` là đúng loại lỗi mà cổng parity không thấy.
    const postPromise = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith('/sessions'), { timeout: 30_000 });

    // Mở panel Luyện tập qua thẻ mode (giống người dùng thật, không gọi hàm).
    await page.locator('.mode-card[data-mode="practice"]').first().click();
    await expect(page.locator('#tab-practice')).toHaveClass(/active/);

    // Chọn Part 2 để khẳng định state của trang thật sự đi vào thân request.
    await page.locator('#prac-tp-part-2').click();
    const select = page.locator('#prac-topic-select');
    await expect(select).toBeEnabled({ timeout: 20_000 });   // chờ /topics trả về

    // Nhập chủ đề tự do — không phụ thuộc danh sách chủ đề của staging.
    const topic = `E2E chủ đề ${Date.now()}`;
    await page.locator('#prac-topic-custom').fill(topic);
    await page.locator('#prac-topic-start').click();

    const req = await postPromise;
    const body = JSON.parse(req.postData() || '{}');
    expect(body, 'thân request phải mang đúng state của trang')
      .toMatchObject({ mode: 'practice', part: 2, topic });

    // Và phải ĐI TỚI trang luyện tập với session_id — nửa sau của luồng.
    await page.waitForURL(/practice\.html\?session_id=/, { timeout: 30_000 });
    const sessionId = new URL(page.url()).searchParams.get('session_id');
    expect(sessionId, 'phải mang session_id sang trang luyện tập').toBeTruthy();
    created.push(sessionId);

    // Phiên có thật ở backend, và mang đúng thuộc tính — không chỉ là một URL.
    const check = await request.get(`${STAGING_API}/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(check.status()).toBe(200);
    const row = await check.json();
    expect(row).toMatchObject({ mode: 'practice', part: 2 });
    expect(row.topic).toBe(topic);
  });

  test('thiếu chủ đề thì BÁO LỖI tại chỗ, KHÔNG tạo phiên', async ({ page, context, request, baseURL }) => {
    // Nửa còn lại của hợp đồng: một nút "làm đúng việc" cũng phải biết TỪ CHỐI.
    // Nếu chốt rỗng hỏng, người dùng tạo ra phiên với chủ đề trống mà không hay.
    await asStudent(context, request, baseURL);
    const res = await page.goto(ROUTE);
    test.skip(!res || res.status() >= 400, `${ROUTE} chưa có trên staging`);

    let posted = false;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/sessions')) posted = true;
    });

    await page.locator('.mode-card[data-mode="practice"]').first().click();
    await page.locator('#prac-topic-start').click();

    await expect(page.locator('#prac-topic-error'))
      .toHaveText('Vui lòng chọn hoặc nhập chủ đề.');
    await page.waitForTimeout(1500);
    expect(posted, 'KHÔNG được gọi POST /sessions khi chưa có chủ đề').toBe(false);
    expect(page.url(), 'phải ở nguyên trang').toContain(ROUTE);
  });

  test('modal chủ đề mở được và nạp danh sách', async ({ page, context, request, baseURL }) => {
    // Modal là đường vào thứ hai để tạo phiên; nó dùng listener riêng nên phải
    // kiểm tách khỏi panel Luyện tập.
    //
    // ĐIỂM MỞ MODAL RẤT HẸP — đo được, không phải suy đoán: trong toàn bộ markup
    // legacy có ĐÚNG MỘT lời gọi `openTopicModal(...)`, và nút đó nằm trong
    // `#grammar-empty` — khối chỉ hiện khi dashboard ngữ pháp KHÔNG có dữ liệu.
    // Học viên đã xem bài ngữ pháp nào thì `#grammar-content` hiện thay, và modal
    // KHÔNG CÒN đường vào nào từ giao diện.
    //
    // Đó là trạng thái hợp lệ của trang, không phải lỗi — nên SKIP kèm lý do
    // thay vì đỏ. Bản đầu bấm thẳng và hết giờ 45s trên staging (tài khoản có dữ
    // liệu ngữ pháp), trong khi kiểm cục bộ lọt vì nó tự trả `{}` cho endpoint đó.
    await asStudent(context, request, baseURL);
    const res = await page.goto(ROUTE);
    test.skip(!res || res.status() >= 400, `${ROUTE} chưa có trên staging`);

    const trigger = page.locator('#grammar-cta-start');
    await page.waitForTimeout(3000);   // để dashboard ngữ pháp quyết định hiện khối nào
    test.skip(!(await trigger.isVisible()),
      'tài khoản có dữ liệu ngữ pháp ⇒ #grammar-empty ẩn ⇒ không có đường vào modal');

    await trigger.click();
    await expect(page.locator('#topic-modal')).toHaveClass(/open/);
    await expect(page.locator('#modal-subtitle'))
      .toHaveText('Bạn muốn luyện tập Part 1 với chủ đề nào?');
    await expect(page.locator('#topic-select')).toBeEnabled({ timeout: 20_000 });

    // Đóng được — nếu không, người dùng kẹt trong modal (body giữ overflow:hidden).
    await page.locator('#modal-close').click();
    await expect(page.locator('#topic-modal')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });
});
