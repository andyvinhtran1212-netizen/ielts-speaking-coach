// Lõi phán xét của cổng đường-ghi.
//
// Cổng này bịt chỗ mà cổng parity mù: parity so TRẠNG THÁI TĨNH, nên nó không
// phân biệt "nút có nhãn đúng" với "nút LÀM ĐÚNG VIỆC" — và với trang ghi, sai
// nghĩa là **nộp bài lên nhầm assignment**, **ghi đè bản nháp bằng rỗng**, hoặc
// **nộp hai lần**.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_BODY, NO_LIST, NO_TEXT, NON_EMPTY, bodyMatches, isWrite, judge, normalizePath,
} from '../tooling/write-flow-core.mjs';

const W = (method, url, body) => ({ method, url, body });

describe('cổng đường-ghi — chuẩn hoá đường dẫn', () => {
  test('bỏ origin và query, giữ nguyên hình dạng đường dẫn', () => {
    assert.equal(normalizePath('http://x/api/a/b?c=1#d'), '/api/a/b');
    assert.equal(normalizePath('/api/a/b'), '/api/a/b');
  });

  test('thay uuid / số dài / hex dài bằng :id', () => {
    assert.equal(normalizePath('/api/writing/my-assignments/8f14e45f-ceea-467a-9c6b-1a2b3c4d5e6f/submit'),
      '/api/writing/my-assignments/:id/submit');
    assert.equal(normalizePath('/sessions/123456/complete'), '/sessions/:id/complete');
  });

  test('KHÔNG thay đoạn chữ — nếu không `submit` và `draft` sẽ trông giống nhau', () => {
    // Thay quá tay là mất khả năng phân biệt hai thao tác có hậu quả rất khác:
    // một cái tự lưu, một cái nộp bài không hoàn tác được.
    const a = normalizePath('/api/writing/my-assignments/8f14e45f-ceea-467a-9c6b-1a2b3c4d5e6f/submit');
    const b = normalizePath('/api/writing/my-assignments/8f14e45f-ceea-467a-9c6b-1a2b3c4d5e6f/draft');
    assert.notEqual(a, b);
    assert.equal(normalizePath('/api/writing/start'), '/api/writing/start');
  });

  test('chỉ POST/PUT/PATCH/DELETE là ghi', () => {
    for (const m of ['POST', 'put', 'PATCH', 'delete']) assert.ok(isWrite(m), m);
    for (const m of ['GET', 'head', 'OPTIONS', '']) assert.ok(!isWrite(m), m);
  });
});

describe('cổng đường-ghi — khớp thân request', () => {
  test('khớp BỘ PHẬN: trường phụ không khai thì bỏ qua', () => {
    // Ghim cứng toàn bộ payload chỉ tạo test giòn — payload thật hay có thêm
    // timestamp, cờ máy khách.
    assert.ok(bodyMatches({ a: 1, extra: 'x' }, { a: 1 }).ok);
  });

  test('NON_EMPTY chặn ghi đè bằng rỗng', () => {
    // Ca thật: `PATCH …/draft` với `draft_text: ""` sẽ XOÁ bài người dùng đang
    // viết. Không phép so tĩnh nào thấy được.
    assert.ok(bodyMatches({ draft_text: 'nội dung' }, { draft_text: NON_EMPTY }).ok);
    for (const bad of ['', '   ', null, undefined, []]) {
      const r = bodyMatches({ draft_text: bad }, { draft_text: NON_EMPTY });
      assert.equal(r.ok, false, `«${JSON.stringify(bad)}» phải bị chặn`);
      assert.match(r.why, /rỗng/);
    }
  });

  test('hàm điều kiện và giá trị cứng', () => {
    assert.ok(bodyMatches({ part: 2 }, { part: 2 }).ok);
    assert.equal(bodyMatches({ part: 1 }, { part: 2 }).ok, false);
    assert.ok(bodyMatches({ n: 5 }, { n: (v) => v > 3 }).ok);
    assert.equal(bodyMatches({ n: 2 }, { n: (v) => v > 3 }).ok, false);
  });

  test('không có thân request mà bản khai đòi ⇒ hỏng', () => {
    assert.equal(bodyMatches(null, { a: 1 }).ok, false);
    assert.ok(bodyMatches(null, null).ok, 'không khai thì không đòi');
  });
});

describe('cổng đường-ghi — phán xét lượt chạy', () => {
  const SUBMIT = '/api/writing/my-assignments/8f14e45f-ceea-467a-9c6b-1a2b3c4d5e6f/submit';
  const DRAFT = '/api/writing/my-assignments/8f14e45f-ceea-467a-9c6b-1a2b3c4d5e6f/draft';

  test('khớp đúng bản khai ⇒ pass', () => {
    const r = judge(
      [W('GET', '/api/x'), W('POST', SUBMIT, { essay_text: 'bài' })],
      [{ method: 'POST', path: '/api/writing/my-assignments/:id/submit', body: { essay_text: NON_EMPTY } }],
    );
    assert.ok(r.pass, JSON.stringify(r.findings));
    assert.equal(r.writeCount, 1, 'GET không tính là ghi');
  });

  test('GHI KHÔNG KHAI là lỗi — đây là bất biến cốt lõi', () => {
    // Chính là hình dạng của "nút làm sai việc": request đúng cú pháp, đúng
    // thời điểm, nhưng đi tới chỗ không ai định.
    const r = judge([W('POST', '/api/writing/my-assignments/abc/publish', {})], []);
    assert.equal(r.pass, false);
    assert.equal(r.findings[0].kind, 'write-undeclared');
  });

  test('NỘP HAI LẦN bị bắt', () => {
    const r = judge(
      [W('POST', SUBMIT, { essay_text: 'a' }), W('POST', SUBMIT, { essay_text: 'a' })],
      [{ method: 'POST', path: '/api/writing/my-assignments/:id/submit', body: { essay_text: NON_EMPTY } }],
    );
    assert.equal(r.pass, false);
    assert.equal(r.findings[0].kind, 'write-count');
    assert.match(r.findings[0].why, /hai lần/);
  });

  test('khai mà KHÔNG xảy ra cũng là lỗi', () => {
    const r = judge([], [{ method: 'POST', path: '/api/x' }]);
    assert.equal(r.pass, false);
    assert.equal(r.findings[0].kind, 'write-missing');
  });

  test('sai thân request bị bắt kể cả khi đường dẫn đúng', () => {
    const r = judge(
      [W('PATCH', DRAFT, { draft_text: '' })],
      [{ method: 'PATCH', path: '/api/writing/my-assignments/:id/draft', body: { draft_text: NON_EMPTY } }],
    );
    assert.equal(r.pass, false);
    assert.equal(r.findings[0].kind, 'write-body');
  });

  test('`ignore` chỉ tha telemetry, KHÔNG tha đường nghiệp vụ', () => {
    const r = judge(
      [W('POST', '/api/analytics/events', {}), W('POST', SUBMIT, { essay_text: 'a' })],
      [],
      { ignore: ['/api/analytics/events'] },
    );
    assert.equal(r.pass, false, 'submit vẫn phải bị bắt');
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0].what, /submit/);
  });

  test('SAI THỨ TỰ bị bắt — nộp trước khi lưu nháp = nộp bản cũ', () => {
    // Codex bắt ở PR #944: bản đầu khớp mỗi bản khai với BẤT KỲ request chưa
    // dùng nào, nên `submit` xảy ra TRƯỚC `draft` vẫn qua một bản khai ghi
    // `draft` trước. Với luồng ghi đó đúng là hồi quy cần bắt.
    const decl = [
      { method: 'PATCH', path: '/api/writing/my-assignments/:id/draft', body: { draft_text: NON_EMPTY } },
      { method: 'POST', path: '/api/writing/my-assignments/:id/submit', body: { essay_text: NON_EMPTY } },
    ];
    const đúng = judge([W('PATCH', DRAFT, { draft_text: 'a' }), W('POST', SUBMIT, { essay_text: 'a' })], decl);
    assert.ok(đúng.pass, JSON.stringify(đúng.findings));

    const sai = judge([W('POST', SUBMIT, { essay_text: 'a' }), W('PATCH', DRAFT, { draft_text: 'a' })], decl);
    assert.equal(sai.pass, false, 'submit trước draft phải bị bắt');
    assert.ok(sai.findings.some((f) => f.kind === 'write-order'),
      `kỳ vọng write-order, nhận ${JSON.stringify(sai.findings.map((f) => f.kind))}`);
  });

  test('`unordered` phải KHAI RA mới được bỏ qua thứ tự', () => {
    // Mặc định là CÓ thứ tự. Muốn miễn thì phải nói, không im lặng.
    const decl = [
      { method: 'POST', path: '/api/b' },
      { method: 'POST', path: '/api/a', unordered: true },
    ];
    const r = judge([W('POST', '/api/a', {}), W('POST', '/api/b', {})], decl);
    assert.ok(r.pass, JSON.stringify(r.findings));
  });

  test('`times` cho phép khai số lần (paste-log bắn nhiều lần)', () => {
    const P = '/api/writing/my-assignments/8f14e45f-ceea-467a-9c6b-1a2b3c4d5e6f/paste-log';
    const r = judge(
      [W('POST', P, { char_count: 10 }), W('POST', P, { char_count: 20 })],
      [{ method: 'POST', path: '/api/writing/my-assignments/:id/paste-log', times: 2 }],
    );
    assert.ok(r.pass, JSON.stringify(r.findings));
  });
});

describe('NO_LIST / NO_TEXT — trường chéo-chế-độ không được mang dữ liệu', () => {
  // codex cục bộ (#966): ghim "phải vắng" bằng `(v) => v == null` nhận CẢ
  // `answers: null` — thân request mà production trả 422 (`answers: list[str]`,
  // `routers/listening.py:327`).
  // Bot #966 vòng 2: ghim "phải vắng hẳn" lại quá chặt với
  // `listening_session_id: str | None` (331), vốn CHO PHÉP null.
  // Bot #966 vòng 3: một ký hiệu nhận cả `''` lẫn `[]` thì MÙ KIỂU — `answers: ''`
  // với trường `list[str]` vẫn xanh. Nên tách hai, chặt đúng bằng kiểu khai.
  test('vắng ⇒ đạt', () => {
    assert.equal(bodyMatches({ a: 1 }, { answers: NO_LIST }).ok, true);
    assert.equal(bodyMatches({ a: 1 }, { user_transcript: NO_TEXT }).ok, true);
  });

  test('rỗng ĐÚNG KIỂU ⇒ đạt (vô hại)', () => {
    assert.equal(bodyMatches({ answers: [] }, { answers: NO_LIST }).ok, true);
    assert.equal(bodyMatches({ user_transcript: '' }, { user_transcript: NO_TEXT }).ok, true);
  });

  test('rỗng SAI KIỂU ⇒ ĐỎ — đây là điểm ký hiệu gộp bỏ lọt', () => {
    const a = bodyMatches({ answers: '' }, { answers: NO_LIST });
    assert.equal(a.ok, false);
    assert.match(a.why, /phải là danh sách/);
    const b = bodyMatches({ user_transcript: [] }, { user_transcript: NO_TEXT });
    assert.equal(b.ok, false);
    assert.match(b.why, /phải là chuỗi/);
  });

  test('mang dữ liệu ⇒ ĐỎ', () => {
    assert.match(bodyMatches({ answers: ['T'] }, { answers: NO_LIST }).why,
      /mang dữ liệu của chế độ khác/);
    assert.match(bodyMatches({ user_transcript: 'x' }, { user_transcript: NO_TEXT }).why,
      /mang dữ liệu của chế độ khác/);
  });

  test('null ⇒ ĐỎ, vì kiểu khai ở backend không nhận null', () => {
    assert.match(bodyMatches({ answers: null }, { answers: NO_LIST }).why, /không nhận null/);
    assert.match(bodyMatches({ user_transcript: null }, { user_transcript: NO_TEXT }).why,
      /không nhận null/);
  });

  test('cách viết CŨ nhận null — chứng minh khác biệt là có thật', () => {
    // Ghim LÝ DO thay đổi: ai quay lại `(v) => v == null` cho trường bài làm sẽ
    // thấy ngay hai cách KHÔNG tương đương.
    assert.equal(bodyMatches({ answers: null }, { answers: (v) => v == null }).ok, true);
  });
});

describe('NO_BODY và thân request dạng hàm', () => {
  // Cả hai đều từ codex cục bộ #969, và cái thứ hai là một bẫy ÂM THẦM: viết
  // `body: (b) => ...` trước đây KHÔNG kiểm gì cả, vì `Object.entries(fn)` trả
  // mảng rỗng nên vòng lặp không chạy lần nào. Bản khai đọc như đang kiểm chặt.
  test('NO_BODY: không thân ⇒ đạt', () => {
    assert.equal(bodyMatches(null, NO_BODY).ok, true);
    assert.equal(bodyMatches('', NO_BODY).ok, true);
  });

  test('NO_BODY: có thân ⇒ ĐỎ (khác hẳn với bỏ trống `body` = không soi)', () => {
    const r = bodyMatches({ rac: 1 }, NO_BODY);
    assert.equal(r.ok, false);
    assert.match(r.why, /phải KHÔNG có thân/);
    // Đối chiếu: bỏ trống thì cùng thân đó lại qua.
    assert.equal(bodyMatches({ rac: 1 }, null).ok, true);
  });

  test('hàm ở mức đỉnh soi CẢ thân — cặp hoán đổi phải ĐỎ', () => {
    const pair = (b) => (b.q_num === 1 && b.user_answer === 'a')
      || (b.q_num === 2 && b.user_answer === 'b');
    assert.equal(bodyMatches({ q_num: 1, user_answer: 'a' }, pair).ok, true);
    assert.equal(bodyMatches({ q_num: 1, user_answer: 'b' }, pair).ok, false);
  });

  test('cách khai TỪNG TRƯỜNG cho cặp hoán đổi đi qua — lý do phải dùng hàm', () => {
    const perField = { q_num: (v) => v === 1 || v === 2, user_answer: (v) => v === 'a' || v === 'b' };
    assert.equal(bodyMatches({ q_num: 1, user_answer: 'b' }, perField).ok, true);
  });
});

describe('bodyAll — soi CẢ TẬP thân request đã khớp', () => {
  // bot #969: với `times: 2`, `body` được gọi RIÊNG từng request, nên vị từ
  // "là cặp câu 1 HOẶC cặp câu 2" vẫn qua khi trang gửi HAI LẦN cùng một câu —
  // câu còn lại không được lưu, đúng thứ bản khai tưởng mình đang chặn.
  const W = (m, u, b) => ({ method: m, url: u, body: b });
  const decl = (extra) => [{
    method: 'PATCH', path: '/a/answers', times: 2,
    body: (b) => (b.q_num === 1 && b.v === 'x') || (b.q_num === 2 && b.v === 'y'),
    ...extra,
  }];

  test('KHÔNG có bodyAll: hai lần cùng một câu vẫn qua — lý do cần nó', () => {
    const r = judge([W('PATCH', 'https://h/a/answers', { q_num: 1, v: 'x' }),
      W('PATCH', 'https://h/a/answers', { q_num: 1, v: 'x' })], decl({}));
    assert.equal(r.pass, true);
  });

  test('CÓ bodyAll: hai lần cùng một câu ⇒ ĐỎ', () => {
    const all = { bodyAll: (bs) => new Set(bs.map((b) => b.q_num)).size === 2 };
    const r = judge([W('PATCH', 'https://h/a/answers', { q_num: 1, v: 'x' }),
      W('PATCH', 'https://h/a/answers', { q_num: 1, v: 'x' })], decl(all));
    assert.equal(r.pass, false);
    assert.match(r.findings[0].why, /cả tập/);
  });

  test('bodyAll KHÔNG phải hàm ⇒ ĐỎ, không được lặng lẽ bỏ qua', () => {
    // `bodyAll: true` là cách gõ nhầm dễ gặp; bỏ qua nó thì bản khai đọc như
    // đang chặn trùng lặp trong khi không chặn gì (codex cục bộ #969).
    const r = judge([W('PATCH', 'https://h/a/answers', { q_num: 1, v: 'x' }),
      W('PATCH', 'https://h/a/answers', { q_num: 1, v: 'x' })], decl({ bodyAll: true }));
    assert.equal(r.pass, false);
    assert.match(r.findings[0].why, /phải là HÀM/);
  });

  test('CÓ bodyAll: đủ hai câu ⇒ đạt', () => {
    const all = { bodyAll: (bs) => new Set(bs.map((b) => b.q_num)).size === 2 };
    const r = judge([W('PATCH', 'https://h/a/answers', { q_num: 1, v: 'x' }),
      W('PATCH', 'https://h/a/answers', { q_num: 2, v: 'y' })], decl(all));
    assert.equal(r.pass, true);
  });
});

describe('so TIÊU ĐỀ request', () => {
  // Có hợp đồng mà bằng chứng nằm ở tiêu đề: bài Đọc qua liên kết chia sẻ mang
  // danh tính ẩn danh ở `X-Reading-Anon`, và mất nó thì máy chủ từ chối lưu —
  // mất bài của học viên trong khi thân request vẫn đúng từng chữ.
  const W = (h) => ({ method: 'POST', url: 'https://h/a/x', body: {}, headers: h });
  const D = (headers) => [{ method: 'POST', path: '/a/x', headers }];

  test('khớp giá trị ⇒ đạt', () => {
    assert.equal(judge([W({ 'x-reading-anon': 'abc' })], D({ 'X-Reading-Anon': 'abc' })).pass, true);
  });

  test('KHÔNG phân biệt hoa thường ở TÊN tiêu đề (RFC 9110 §5.1)', () => {
    assert.equal(judge([W({ 'X-Reading-Anon': 'abc' })], D({ 'x-reading-anon': 'abc' })).pass, true);
  });

  test('thiếu tiêu đề ⇒ ĐỎ', () => {
    const r = judge([W({})], D({ 'X-Reading-Anon': 'abc' }));
    assert.equal(r.pass, false);
    assert.equal(r.findings[0].kind, 'write-header');
  });

  test('sai giá trị ⇒ ĐỎ', () => {
    assert.equal(judge([W({ 'x-reading-anon': 'khac' })], D({ 'X-Reading-Anon': 'abc' })).pass, false);
  });

  test('vị từ ghim "phải VẮNG" ⇒ có mặt là ĐỎ', () => {
    const d = D({ 'X-Reading-Anon': (v) => v === undefined });
    assert.equal(judge([W({})], d).pass, true);
    assert.equal(judge([W({ 'x-reading-anon': 'tu-bia-ra' })], d).pass, false);
  });
});
