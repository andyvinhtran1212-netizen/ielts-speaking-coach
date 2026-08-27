/**
 * Giao bài Speaking SAU BUỔI HỌC (ô giao bài, trang Lớp học).
 *
 * Khác bài hằng ngày ở ba chỗ, và cả ba đều hỏng được trong im lặng:
 *   · nguồn đề là kho THEO BUỔI của khoá, không phải kho chủ đề chung;
 *   · số câu do bộ đề quyết, mặc định giao trọn bộ (giáo viên TRỪ đi);
 *   · hạn nhập bằng SỐ NGÀY — mà "7 ngày" tự nó không kiểm tra được.
 *
 * Mọi phép kiểm ở đây CHẠY THẬT mã nguồn với DOM giả. Khớp chuỗi chỉ dùng cho
 * dây nối sự kiện, chỗ không gọi hàm được — và ngay cả ở đó thì cũng kiểm sự
 * kiện được gắn vào ĐÚNG vùng chứa, không phải kiểm có mặt một cái tên.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
const HTML = readFileSync(join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');
const CSS = readFileSync(join(HERE, '..', 'public', 'css', 'speaking-assignment.css'), 'utf8');

// Cắt từ SKILL_LABEL: `applyHomeworkSkill` đọc nó, và tiêm một bản giả sẽ là
// test một hằng số KHÁC với hằng số mã thật dùng.
const START = 'const SKILL_LABEL = {';
const END = 'async function setHomeworkStatus(';

/**
 * Nạp vùng mã thật của ô giao bài, với DOM + api giả.
 *
 * `kind` là loại bài đang chọn; `now` là mốc thời gian cố định để bộ quy hạn
 * kiểm được (không cố định thì test sẽ đỏ vào lúc nửa đêm).
 */
function load({ kind = 'daily', now = '2026-08-04T03:00:00Z', sets = [], setQuestions = [],
                banks = [], failGet = null } = {}) {
  const start = SRC.indexOf(START);
  const end = SRC.indexOf(END);
  assert.ok(start !== -1 && end > start, 'không tìm thấy vùng mã ô giao bài');

  const mk = (extra = {}) => ({ value: '', textContent: '', innerHTML: '',
    hidden: false, disabled: false, dataset: {}, selectedOptions: [{ text: '' }],
    addEventListener() {}, closest: () => null, ...extra });
  const nodes = {};
  for (const id of ['hf-skill-field', 'hf-skill', 'hf-kind-note', 'hf-topic-field',
    'hf-topic', 'hf-topic-note', 'hf-set-field', 'hf-set', 'hf-set-note',
    // Kho bài tập theo buổi (giáo trình) — node mới, khuôn giả phải có đủ.
    'hf-cbank-field', 'hf-cbank', 'hf-cbank-note', 'hf-pass-pct', 'hf-retake-size',
    'hf-speaking-row', 'hf-part', 'hf-test-field', 'hf-test', 'hf-mode',
    'hf-due-date-field', 'hf-due-days-field', 'hf-due', 'hf-due-days', 'hf-due-time',
    'hf-due-resolve', 'hf-due-resolve-at', 'hf-due-resolve-why',
    'hf-qpick-field', 'hf-qpick', 'hf-qpick-list', 'hf-qpick-foot', 'hf-qmode-hint',
    'hf-instructions', 'hf-title', 'hf-error', 'hf-warning', 'homework-modal',
    'homework-modal-title', 'btn-hf-submit']) nodes[id] = mk();
  // Ô Part sống trong một .adm-field bị ẩn cả cụm ở chế độ bài theo buổi.
  const partField = mk();
  nodes['hf-part'].closest = (sel) => (sel === '.adm-field' ? partField : null);
  nodes['hf-skill'].value = 'speaking';
  nodes['hf-due-time'].value = '19:00';
  nodes['hf-due-days'].value = '7';

  const kindBox = { addEventListener() {}, _bound: [] };
  // Loại bài đổi được TRONG CÙNG một lần nạp: người dùng thật bấm qua lại trên
  // cùng một ô, và lỗi "danh sách câu của nguồn cũ ở lại" chỉ lộ ra khi ấy.
  let currentKind = kind;
  const posted = [];
  const toasts = [];
  const document = {
    querySelector(sel) {
      if (sel.includes('hf-kind')) return { value: currentKind };
      if (sel.includes('hf-qmode')) return { value: 'manual' };
      if (sel === '.av-kind') return kindBox;
      return null;
    },
    querySelectorAll: () => [],
  };
  const api = {
    async get(path) {
      if (failGet) throw new Error(failGet);
      if (path.includes('/course-banks')) return { items: banks };
      if (path.includes('/speaking-lesson-sets/')) return { items: setQuestions };
      if (path.includes('/speaking-lesson-sets')) return { items: sets };
      return { items: [] };
    },
    async post(path, body) { posted.push({ path, body }); return { student_count: 5 }; },
  };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const src = SRC.slice(start, end);
  const ctx = new Function(
    '$', 'document', 'api', 'esc', 'toast', '_cohortId', 'closeHomeworkModal',
    'loadHomework', 'vietnamParts', 'defaultDueDateVietnam', 'previewQuestionAudio',
    'Date',
    `${src}
     return { hfKind, applyHomeworkKind, applyHomeworkSkill, renderDueResolve,
              loadLessonSets, loadSetQuestions, toggleQpick, renderQpick,
              submitLessonHomework, submitHomework,
              loadCourseBanks, submitCourseHomework,
              get state() { return _qpick; }, set state(v) { _qpick = v; } };`,
  )(
    (id) => nodes[id],
    document,
    api,
    esc,
    (m, t) => toasts.push({ m, t }),
    'co-1',
    () => {},
    async () => {},
    // Cùng luật với mã thật: ngày theo giờ Việt Nam.
    (at) => {
      const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
      }).formatToParts(at).reduce((o, x) => (o[x.type] = x.value, o), {});
      return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
    },
    () => '2026-08-04',
    () => {},
    // Đồng hồ cố định: `new Date()` trả mốc đã chọn, `new Date(x)` giữ nguyên.
    class FrozenDate extends Date {
      constructor(...a) { super(...(a.length ? a : [now])); }
      static now() { return new Date(now).getTime(); }
      static UTC(...a) { return Date.UTC(...a); }
    },
  );
  // Object.create chứ KHÔNG spread: `{ ...ctx }` đọc getter MỘT LẦN rồi chép
  // giá trị, nên mọi phép gán lại `_qpick = {...}` trong mã thật trở nên vô
  // hình — đúng loại lỗi bộ test này phải bắt được.
  return Object.assign(Object.create(ctx), {
    nodes, partField, posted, toasts, kindBox,
    setKind(k) { currentKind = k; },
  });
}

const SET = (over = {}) => ({ id: 's1', lesson_no: 1, part: 1, title: 'Buổi 1',
  question_count: 12, already_given: false, ready: true, missing_audio: 0, ...over });
const SQ = (id, ready = true) => ({ id, order_num: Number(id.slice(1)),
  question_text: `Câu ${id}`, level: 'easy', ready, audio_url: `https://cdn/${id}.mp3` });


// ── Loại bài đổi cả bộ mặt ô giao ────────────────────────────────────────────

describe('chọn loại bài', () => {
  test('bài theo buổi: ô Kỹ năng và ô Part BIẾN MẤT', () => {
    // Ẩn chứ không khoá: một ô hiện ra mà bấm không được vẫn bắt người ta dừng
    // lại đọc xem vì sao. Và "sau buổi học" đương nhiên là Speaking.
    const p = load({ kind: 'lesson' });
    p.applyHomeworkKind();
    assert.equal(p.nodes['hf-skill-field'].hidden, true);
    assert.equal(p.partField.hidden, true);
    assert.equal(p.nodes['hf-set-field'].hidden, false);
    assert.equal(p.nodes['hf-topic-field'].hidden, true);
  });

  test('bài hằng ngày: kho chủ đề chung quay lại, kho theo buổi ẩn', () => {
    const p = load({ kind: 'daily' });
    p.applyHomeworkKind();
    assert.equal(p.nodes['hf-skill-field'].hidden, false);
    assert.equal(p.partField.hidden, false);
    assert.equal(p.nodes['hf-set-field'].hidden, true);
    assert.equal(p.nodes['hf-topic-field'].hidden, false);
  });

  test('hai cách nhập hạn không cùng hiện — backend từ chối nếu gửi cả hai', () => {
    const a = load({ kind: 'lesson' }); a.applyHomeworkKind();
    assert.equal(a.nodes['hf-due-date-field'].hidden, true);
    assert.equal(a.nodes['hf-due-days-field'].hidden, false);

    const b = load({ kind: 'daily' }); b.applyHomeworkKind();
    assert.equal(b.nodes['hf-due-date-field'].hidden, false);
    assert.equal(b.nodes['hf-due-days-field'].hidden, true);
  });

  test('chọn bài theo buổi thì Kỹ năng bị ép về Speaking', () => {
    const p = load({ kind: 'lesson' });
    p.nodes['hf-skill'].value = 'reading';
    p.applyHomeworkKind();
    assert.equal(p.nodes['hf-skill'].value, 'speaking');
  });
});


// ── Bộ quy hạn: chỗ duy nhất tiêu độ táo bạo ─────────────────────────────────

describe('bộ quy hạn', () => {
  test('"7 ngày" được quy ra MỐC TUYỆT ĐỐI kèm thứ trong tuần', () => {
    // 04/08/2026 giờ VN + 7 ngày = 11/08/2026, là thứ Ba.
    const p = load({ kind: 'lesson', now: '2026-08-04T03:00:00Z' });
    p.renderDueResolve();
    assert.equal(p.nodes['hf-due-resolve-at'].textContent, '19:00 · Thứ Ba 11/08/2026');
    assert.equal(p.nodes['hf-due-resolve'].dataset.empty, 'false');
  });

  test('đổi giờ thì mốc đổi theo — nếu không nó đang nói dối về thứ sắp lưu', () => {
    const p = load({ kind: 'lesson' });
    p.nodes['hf-due-time'].value = '23:59';
    p.renderDueResolve();
    assert.match(p.nodes['hf-due-resolve-at'].textContent, /^23:59 · /);
  });

  test('ngày được đếm theo GIỜ VIỆT NAM, không theo múi giờ trình duyệt', () => {
    // 23:30 UTC ngày 04/08 đã là 06:30 ngày 05/08 ở Việt Nam. Đếm bằng máy của
    // admin đang ở nước ngoài sẽ ra 11/08 thay vì 12/08.
    const p = load({ kind: 'lesson', now: '2026-08-04T23:30:00Z' });
    p.renderDueResolve();
    assert.match(p.nodes['hf-due-resolve-at'].textContent, /12\/08\/2026$/);
  });

  test('số ngày trống hoặc ngoài khoảng thì KHÔNG bịa ra một mốc', () => {
    for (const bad of ['', '0', '91', 'x']) {
      const p = load({ kind: 'lesson' });
      p.nodes['hf-due-days'].value = bad;
      p.renderDueResolve();
      assert.equal(p.nodes['hf-due-resolve-at'].textContent, '—', `giá trị ${JSON.stringify(bad)}`);
      assert.equal(p.nodes['hf-due-resolve'].dataset.empty, 'true');
    }
  });

  test('bài hằng ngày thì bộ quy hạn không chạy', () => {
    const p = load({ kind: 'daily' });
    p.nodes['hf-due-resolve-at'].textContent = 'KHÔNG ĐƯỢC ĐỘNG';
    p.renderDueResolve();
    assert.equal(p.nodes['hf-due-resolve-at'].textContent, 'KHÔNG ĐƯỢC ĐỘNG');
  });
});


// ── Kho đề theo buổi ─────────────────────────────────────────────────────────

describe('danh sách buổi', () => {
  test('buổi lớp đã giao và buổi thiếu bản đọc đều bị ẩn, kèm LÝ DO TÁCH RIÊNG', async () => {
    // Gộp cả hai vào một chữ "không dùng được" sẽ giấu mất một việc đang chờ
    // người làm: thiếu bản đọc thì chạy mẻ render là xong.
    const p = load({ kind: 'lesson', sets: [
      SET({ id: 's1', lesson_no: 1 }),
      SET({ id: 's2', lesson_no: 2, already_given: true }),
      SET({ id: 's3', lesson_no: 3, ready: false, missing_audio: 3 }),
    ] });
    await p.loadLessonSets();
    assert.match(p.nodes['hf-set'].innerHTML, /Buổi 1/);
    assert.doesNotMatch(p.nodes['hf-set'].innerHTML, /Buổi 2/);
    assert.doesNotMatch(p.nodes['hf-set'].innerHTML, /Buổi 3/);
    const note = p.nodes['hf-set-note'].textContent;
    assert.match(note, /1 buổi lớp này đã làm/);
    assert.match(note, /1 buổi còn thiếu 3 bản đọc/);
    assert.equal(p.nodes['hf-set-note'].dataset.tone, 'warn');
  });

  test('khoá chưa có bộ đề nào thì nói ra, không để danh sách rỗng im lặng', async () => {
    const p = load({ kind: 'lesson', sets: [] });
    await p.loadLessonSets();
    assert.match(p.nodes['hf-set-note'].textContent, /chưa có bộ đề nào/i);
  });

  test('lớp chưa gắn khoá: chép NGUYÊN câu backend nói, vì đó là câu chỉ ra việc phải làm', async () => {
    const p = load({ kind: 'lesson',
      failGet: 'Lớp này chưa được gắn vào khoá nào, nên chưa có kho đề theo buổi.' });
    await p.loadLessonSets();
    assert.equal(p.nodes['hf-set-note'].dataset.tone, 'error');
    assert.match(p.nodes['hf-set-note'].textContent, /gắn vào khoá/);
  });
});


// ── Bớt câu khỏi bộ ──────────────────────────────────────────────────────────

describe('chọn câu trong bộ đề của buổi', () => {
  test('mở bộ ra là CẢ BỘ đã bật — giáo viên trừ đi, không cộng vào', async () => {
    const p = load({ kind: 'lesson', setQuestions: [SQ('q1'), SQ('q2'), SQ('q3')] });
    p.nodes['hf-set'].value = 's1';
    await p.loadSetQuestions();
    assert.deepEqual(p.state.picked, ['q1', 'q2', 'q3']);
    assert.equal(p.state.mode, 'subset');
  });

  test('câu chưa có bản đọc KHÔNG tự bật', async () => {
    // Bật rồi bị backend từ chối lúc bấm Giao là bắt giáo viên đi tìm câu nào hỏng.
    const p = load({ kind: 'lesson', setQuestions: [SQ('q1'), SQ('q2', false)] });
    p.nodes['hf-set'].value = 's1';
    await p.loadSetQuestions();
    assert.deepEqual(p.state.picked, ['q1']);
  });

  test('số trong ô là số CỦA BỘ, đứng yên — không phải thứ tự bấm', async () => {
    // Ở kho chung, thứ tự bấm là thông tin thật. Ở đây KHÔNG: người soạn đã sắp
    // mạch, và backend luôn xếp lại theo thứ tự trong bộ. Đánh số theo cú bấm sẽ
    // là nói dối về thứ mà cú bấm ấy quyết định.
    const p = load({ kind: 'lesson', setQuestions: [SQ('q1'), SQ('q2'), SQ('q3')] });
    p.nodes['hf-set'].value = 's1';
    await p.loadSetQuestions();
    // Phải TẮT một câu thì hai cách đánh số mới khác nhau: bỏ câu 1 đi, cách
    // đánh theo cú bấm sẽ dồn q2 thành "1", còn số của bộ vẫn phải là "2".
    // (Bật hết rồi bật lại thì hai cách cho kết quả giống hệt — một phép thử
    // như vậy trông đúng mà không chứng minh được gì.)
    p.toggleQpick('q1');
    const html = p.nodes['hf-qpick-list'].innerHTML;
    assert.deepEqual(p.state.picked, ['q2', 'q3']);
    assert.match(html, /data-id="q2"[\s\S]{0,200}?__num" aria-hidden="true">2</);
    assert.match(html, /data-id="q3"[\s\S]{0,200}?__num" aria-hidden="true">3</);
    assert.doesNotMatch(html, /data-id="q2"[\s\S]{0,200}?__num" aria-hidden="true">1</);
    p.toggleQpick('q1');
    assert.deepEqual(p.state.picked, ['q1', 'q2', 'q3'], 'bật lại phải về đúng chỗ cũ');
  });

  test('không có trần số câu — bật tắt tự do', async () => {
    const p = load({ kind: 'lesson', setQuestions: [SQ('q1'), SQ('q2'), SQ('q3')] });
    p.nodes['hf-set'].value = 's1';
    await p.loadSetQuestions();
    p.toggleQpick('q1'); p.toggleQpick('q2');
    assert.deepEqual(p.state.picked, ['q3']);
    p.toggleQpick('q1');
    assert.deepEqual(p.state.picked, ['q1', 'q3'], 'không đẩy câu cũ ra như chế độ bốc');
  });

  test('chân danh sách nói GIAO BAO NHIÊU, không nói "còn thiếu mấy câu"', async () => {
    const p = load({ kind: 'lesson', setQuestions: [SQ('q1'), SQ('q2'), SQ('q3')] });
    p.nodes['hf-set'].value = 's1';
    await p.loadSetQuestions();
    assert.match(p.nodes['hf-qpick-foot'].innerHTML, /Giao <strong>3\/3<\/strong> câu/);
    p.toggleQpick('q2');
    assert.match(p.nodes['hf-qpick-foot'].innerHTML, /Giao <strong>2\/3<\/strong> câu/);
    assert.match(p.nodes['hf-qpick-foot'].innerHTML, /Đã bỏ 1 câu/);
  });
});


// ── Gửi đi ───────────────────────────────────────────────────────────────────

describe('bấm Giao cho cả lớp', () => {
  async function ready(setQuestions = [SQ('q1'), SQ('q2')]) {
    const p = load({ kind: 'lesson', setQuestions });
    p.nodes['hf-set'].value = 's1';
    p.nodes['hf-mode'].value = 'practice';
    await p.loadSetQuestions();
    return p;
  }

  test('gửi kind=lesson và due_days, TUYỆT ĐỐI không gửi due_date', async () => {
    const p = await ready();
    await p.submitLessonHomework('Bài buổi 1');
    assert.equal(p.posted.length, 1);
    const b = p.posted[0].body;
    assert.equal(b.kind, 'lesson');
    assert.equal(b.due_days, 7);
    assert.ok(!('due_date' in b), 'backend từ chối khi có cả hai cách nhập hạn');
    assert.equal(b.content_id, 's1');
    assert.equal(b.skill, 'speaking');
  });

  test('giao TRỌN BỘ thì không gửi danh sách câu', async () => {
    // Gửi đủ id cũng ra cùng kết quả, nhưng khi ấy bài giao ghim theo một bản
    // chụp của trình duyệt thay vì theo bộ đề thật.
    const p = await ready();
    await p.submitLessonHomework('Bài buổi 1');
    assert.equal(p.posted[0].body.question_ids, null);
  });

  test('bớt câu thì gửi đúng danh sách còn lại', async () => {
    const p = await ready([SQ('q1'), SQ('q2'), SQ('q3')]);
    p.toggleQpick('q2');
    await p.submitLessonHomework('Bài buổi 1');
    assert.deepEqual(p.posted[0].body.question_ids, ['q1', 'q3']);
  });

  test('chưa chọn buổi thì chặn tại chỗ, không tốn một vòng gọi mạng', async () => {
    const p = load({ kind: 'lesson' });
    await p.submitLessonHomework('Bài');
    assert.equal(p.posted.length, 0);
    assert.match(p.nodes['hf-error'].textContent, /Chọn một buổi/);
    assert.equal(p.nodes['hf-error'].hidden, false);
  });

  test('bỏ hết câu thì chặn tại chỗ', async () => {
    const p = await ready();
    p.toggleQpick('q1'); p.toggleQpick('q2');
    await p.submitLessonHomework('Bài');
    assert.equal(p.posted.length, 0);
    assert.match(p.nodes['hf-error'].textContent, /ít nhất một câu/);
  });

  test('số ngày ngoài khoảng thì chặn tại chỗ', async () => {
    const p = await ready();
    p.nodes['hf-due-days'].value = '0';
    await p.submitLessonHomework('Bài');
    assert.equal(p.posted.length, 0);
    assert.match(p.nodes['hf-error'].textContent, /từ 1 đến 90/);
  });

  test('nút Giao được bật lại kể cả khi gửi hỏng', async () => {
    const p = await ready();
    p.nodes['hf-error'].textContent = '';
    await p.submitLessonHomework('Bài buổi 1');
    assert.equal(p.nodes['btn-hf-submit'].disabled, false);
  });
});


// ── Dây nối: chốt biến mất mà không ai biết ──────────────────────────────────

describe('dây nối sự kiện', () => {
  const wiring = SRC.slice(SRC.indexOf("$('btn-hf-submit').addEventListener"));

  test('đổi loại bài có người nghe — nếu không thì cả tính năng này không mở được', () => {
    assert.match(wiring,
      /document\s*\n?\s*\.querySelector\('\.av-kind'\)\s*\n?\s*\.addEventListener\('change', applyHomeworkKind\)/);
  });

  test('chọn buổi thì tải câu của buổi đó', () => {
    assert.match(wiring, /\$\('hf-set'\)\.addEventListener\('change', loadSetQuestions\)/);
  });

  test('bộ quy hạn chạy theo CẢ số ngày lẫn giờ', () => {
    assert.match(wiring, /\$\('hf-due-days'\)\.addEventListener\('input', renderDueResolve\)/);
    assert.match(wiring, /\$\('hf-due-time'\)\.addEventListener\('input', renderDueResolve\)/);
  });

  test('ô giao mở ra là gọi applyHomeworkKind, không phải applyHomeworkSkill', () => {
    // Gọi nhầm hàm cũ thì ô mở ra với các trường của lần giao TRƯỚC.
    const open = SRC.slice(SRC.indexOf('function openHomeworkModal('),
      SRC.indexOf('function closeHomeworkModal('));
    assert.match(open, /applyHomeworkKind\(\)/);
  });
});


// ── Khung và CSS ─────────────────────────────────────────────────────────────

describe('khung trang', () => {
  test('dải chọn loại là radiogroup có nhãn', () => {
    assert.match(HTML, /class="av-kind" role="radiogroup" aria-labelledby="hf-kind-label"/);
    assert.match(HTML, /name="hf-kind" value="daily" checked/);
    assert.match(HTML, /name="hf-kind" value="lesson"/);
  });

  test('ô số ngày chặn ngay ở trình duyệt: 1–90', () => {
    assert.match(HTML, /id="hf-due-days"[^>]*min="1"[^>]*max="90"/);
  });

  test('dòng quy hạn dùng font mono — đó là một giá trị để ĐỐI CHIẾU', () => {
    assert.match(CSS, /\.av-due-resolve strong \{[\s\S]{0,200}?font-family: var\(--av-font-mono\)/);
  });

  test('chế độ bớt câu trông KHÁC chế độ bốc câu', () => {
    assert.match(CSS, /\.av-qpick__list\[data-pick='subset'\]/);
    assert.match(CSS, /\[data-pick='subset'\] \.av-qpick__row\[aria-pressed='false'\] \{[\s\S]{0,80}?opacity/);
  });

  test('không có mã màu cứng — hệ token là nguồn duy nhất', () => {
    assert.equal((CSS.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0);
  });
});


describe('admin xem đủ cue card Part 2 trước khi giao', () => {
  test('danh sách câu hiển thị prompt, gợi ý và câu explain', () => {
    const p = load({ kind: 'lesson' });
    p.state = {
      items: [{
        id: 'cue-1', question_text: 'Describe a journey.', giveable: true,
        cue_card_bullets: ['when you went', 'who you went with'],
        cue_card_reflection: 'and explain why you remember it.',
      }],
      picked: ['cue-1'], want: 1, topicId: 'set-p2', part: '2', mode: 'subset',
    };
    p.renderQpick();
    const html = p.nodes['hf-qpick-list'].innerHTML;
    assert.match(html, /Describe a journey/);
    assert.match(html, /when you went/);
    assert.match(html, /who you went with/);
    assert.match(html, /explain why you remember it/);
  });
});


// ── Vòng review 1 ────────────────────────────────────────────────────────────

describe('đổi loại bài giữa chừng', () => {
  test('câu của buổi cũ KHÔNG ở lại khi quay về bài hằng ngày', async () => {
    // Hai nguồn đề dùng chung một danh sách. Không dọn thì 12 câu của buổi cũ
    // nằm nguyên dưới nhãn "Câu hỏi", và `picked` vẫn giữ id thuộc bộ đề khác —
    // bấm Giao sẽ gửi những id ấy cho một bài hằng ngày.
    const p = load({ kind: 'lesson', setQuestions: [SQ('q1'), SQ('q2')] });
    p.nodes['hf-set'].value = 's1';
    await p.loadSetQuestions();
    assert.equal(p.state.picked.length, 2);

    // Người dùng bấm sang "Bài hằng ngày" trên CHÍNH ô đang mở.
    p.setKind('daily');
    p.applyHomeworkKind();
    assert.deepEqual(p.state.picked, [], 'phải bỏ hết lựa chọn của nguồn cũ');
    assert.deepEqual(p.state.items, []);
    assert.equal(p.nodes['hf-qpick-field'].hidden, true);
    assert.equal(p.nodes['hf-qpick-list'].innerHTML, '');
  });

  test('đổi sang bài theo buổi cũng dọn sạch lựa chọn cũ', () => {
    const p = load({ kind: 'lesson' });
    p.state = { items: [{ id: 'x' }], picked: ['x'], want: 2, topicId: 't', part: '1', mode: 'order' };
    p.applyHomeworkKind();
    assert.deepEqual(p.state.picked, []);
    assert.equal(p.state.mode, 'subset');
    assert.equal(p.state.topicId, null, 'topicId cũ còn lại sẽ khiến bộ nạp tưởng đã tải rồi');
  });
});


// ── Cờ "bài này cần xem lại" trong bảng tổng kết ──────────────────────────────

describe('cờ trong bảng tổng kết', () => {
  /** Chạy THẬT tallyRow + renderTally. */
  function tally(d) {
    // Cắt từ TALLY_WHEN: `tallyRow` đọc nó, và tiêm một bản giả là test một
    // hằng số KHÁC với hằng số mã thật dùng.
    const start = SRC.indexOf('const TALLY_WHEN = {');
    const end = SRC.indexOf('async function openTally(');
    assert.ok(start !== -1 && end > start, 'không tìm thấy vùng bảng tổng kết');
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // `dueText` chỉ định dạng ngày, không phải thứ đang kiểm ở đây.
    const fn = new Function('esc', 'dueText', `${SRC.slice(start, end)}
      return { tallyRow, renderTally };`)(esc, () => '19:00 ngày 04/08');
    // Endpoint LUÔN trả `assignment`; thiếu nó ở đây là thiếu ở test.
    return fn.renderTally({ assignment: { due_at: '2026-08-04T12:00:00Z' }, ...d });
  }

  const row = (over = {}) => ({ student_id: 's1', name: 'Lan', status: 'submitted',
    submitted_at: '2026-08-04T10:00:00Z', score: 6.0, flags: [], flag_level: null, ...over });
  const FLAG = { code: 'low_confidence', severity: 'high', label: 'Điểm không đáng tin',
    why: 'Bản chép lời không rõ.', action: 'Nghe lại bản ghi trước khi dùng điểm này.' };

  test('bài sạch thì KHÔNG có gì thêm — im lặng là mặc định', () => {
    const html = tally({ students: [row()], counts: { total: 1, submitted: 1 } });
    assert.doesNotMatch(html, /av-flags/);
  });

  test('cờ hiện NGAY DƯỚI TÊN, không sau một cú bấm nữa', () => {
    const html = tally({ students: [row({ flags: [FLAG], flag_level: 'high' })],
      counts: { total: 1, submitted: 1, flagged: 1 } });
    const nameAt = html.indexOf('Lan');
    const flagAt = html.indexOf('av-flags');
    assert.ok(nameAt !== -1 && flagAt > nameAt, 'cờ phải đứng sau tên trong cùng khối');
  });

  test('mỗi cờ nói ĐỦ ba thứ: chuyện gì, vì sao, làm gì tiếp', () => {
    const html = tally({ students: [row({ flags: [FLAG], flag_level: 'high' })],
      counts: { total: 1, submitted: 1, flagged: 1 } });
    assert.match(html, /<strong>Điểm không đáng tin<\/strong>/);
    assert.match(html, /<span>Bản chép lời không rõ\.<\/span>/);
    assert.match(html, /<em>Nghe lại bản ghi[^<]*<\/em>/);
  });

  test('số bài cần xem lại KHÔNG trừ vào số đã nộp', () => {
    // Một bài nộp rồi mà chấm hỏng VẪN là đã nộp. Trộn hai con số sẽ khiến giáo
    // viên tưởng em ấy chưa làm bài, trong khi lỗi ở phía hệ thống.
    const html = tally({ students: [row({ flags: [FLAG], flag_level: 'high' })],
      counts: { total: 10, submitted: 10, flagged: 1 } });
    assert.match(html, /10<small>\/10 đã nộp<\/small>/);
    assert.match(html, /1 bài cần xem lại/);
  });

  test('nội dung cờ được thoát HTML — nó đi từ dữ liệu ra màn hình', () => {
    const html = tally({ students: [row({ flag_level: 'medium',
      flags: [{ ...FLAG, label: '<img src=x onerror=alert(1)>' }] })],
      counts: { total: 1, submitted: 1, flagged: 1 } });
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
  });

  test('dòng bị gắn cờ KHÔNG bị nhuộm đỏ như dòng chưa nộp', () => {
    // Bài bị gắn cờ thường VẪN nộp đúng hạn; nhuộm đỏ nó là nói sai về học viên.
    const html = tally({ students: [row({ flags: [FLAG], flag_level: 'high' })],
      counts: { total: 1, submitted: 1, flagged: 1 } });
    assert.match(html, /data-status="submitted"/);
    assert.match(html, /data-flag="high"/);
    assert.doesNotMatch(CSS, /\.av-tally__row\[data-flag[^\n]*background/);
  });

  test('việc-phải-làm có dấu mũi tên để mắt bắt được ngay', () => {
    assert.match(CSS, /\.av-flag em::before \{[\s\S]{0,80}?content: '→ '/);
  });
});


// ── Bảng hiệu suất Speaking (tab Tiến độ) ────────────────────────────────────

describe('bảng hiệu suất Speaking', () => {
  function perf(d) {
    const start = SRC.indexOf('function perfSpark(');
    const end = SRC.indexOf('async function loadProgress(');
    assert.ok(start !== -1 && end > start, 'không tìm thấy vùng bảng hiệu suất');
    const esc = (s2) => String(s2 == null ? '' : s2)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const nodes = {
      'speaking-perf': { hidden: false }, 'perf-scope': { textContent: '' },
      'perf-rows': { innerHTML: '' }, 'perf-foot': { innerHTML: '' },
    };
    const fn = new Function('esc', '$', `${SRC.slice(start, end)}
      return { renderSpeakingPerf, perfSpark };`)(esc, (id) => nodes[id]);
    fn.renderSpeakingPerf(d);
    return nodes;
  }

  const P = (over = {}) => ({ student_id: 's1', name: 'Lan', activated: true,
    assigned: 4, submitted: 4, late: 0, missing: 0, bands: [6, 6.5, 6.5, 6],
    latest_band: 6, avg_band: 6.25, student_flags: [], work_flags: [],
    flag_level: null, ...over });

  test('lớp chưa có bài Speaking nào thì ẨN, không hiện khung rỗng', () => {
    // Khung rỗng đọc như "lớp này chưa ai làm bài", mà sự thật có thể là chưa
    // đọc được dữ liệu.
    assert.equal(perf({ items: [], assignment_count: 0 })['speaking-perf'].hidden, true);
  });

  test('em cần để mắt mang mức cảnh báo trên chính dòng của mình', () => {
    const n = perf({ items: [P({ flag_level: 'high', student_flags: [
      { code: 'band_drop', severity: 'high', label: 'Điểm tụt so với chính em ấy',
        why: 'x', action: 'y' }] })], assignment_count: 4, kinds: ['daily'] });
    assert.match(n['perf-rows'].innerHTML, /data-level="high"/);
    assert.match(n['perf-rows'].innerHTML, /Điểm tụt so với chính em ấy/);
  });

  test('em ổn thì KHÔNG có mức cảnh báo — im lặng là mặc định', () => {
    const n = perf({ items: [P()], assignment_count: 4 });
    assert.doesNotMatch(n['perf-rows'].innerHTML, /data-level=/);
    assert.match(n['perf-rows'].innerHTML, /4\/4 bài/);
  });

  test('cùng một loại cờ trên nhiều bài gộp thành MỘT việc, kèm số lần', () => {
    // Năm dòng "Điểm không đáng tin" là một việc cần làm, không phải năm việc.
    const f = { code: 'low_confidence', severity: 'high',
      label: 'Điểm không đáng tin', why: 'x', action: 'y' };
    const n = perf({ items: [P({ flag_level: 'high', work_flags: [f, f, f] })],
      assignment_count: 4 });
    assert.match(n['perf-rows'].innerHTML, /Điểm không đáng tin ×3/);
    assert.equal((n['perf-rows'].innerHTML.match(/Điểm không đáng tin/g) || []).length, 1);
  });

  test('đường band dùng thang CỐ ĐỊNH 3–9, không co giãn theo từng em', () => {
    // Co giãn theo từng em sẽ làm một em dao động 0.5 band trông y hệt một em
    // dao động 3 band — đúng thứ bảng này phải phân biệt.
    // Ca phân biệt được: CÙNG band 6.0 ở hai em có dải khác nhau. Thang cố định
    // cho ra cùng chiều cao; thang co giãn cho ra hai chiều cao khác nhau, và
    // khi ấy hai em không so được với nhau nữa.
    //
    // (So "phẳng ra ba cột bằng nhau" thì KHÔNG phân biệt được — cả hai công
    // thức đều cho ba cột bằng nhau. Một phép thử như vậy trông đúng mà chẳng
    // chứng minh gì.)
    const h = (html) => (html.match(/height:(\d+)px/g) || []).map((x) => +x.match(/\d+/)[0]);
    // Dải phải LỆCH, không đối xứng: với [5.5, 6, 6.5] thì 6.0 nằm giữa dải ở
    // CẢ hai công thức, nên hai bên cho cùng chiều cao và phép thử vô nghĩa.
    // Ở đây 6.0 là ĐÁY dải của em thứ nhất và GIỮA dải của em thứ hai.
    const lowEnd = h(perf({ items: [P({ bands: [6, 6.5, 7] })], assignment_count: 3 })['perf-rows'].innerHTML);
    const broad = h(perf({ items: [P({ bands: [3, 6, 9] })], assignment_count: 3 })['perf-rows'].innerHTML);
    assert.equal(lowEnd[0], broad[1],
      'band 6.0 phải cao bằng nhau ở mọi học viên — nếu không thì hai em không so được');
    assert.ok(broad[0] < broad[1] && broad[1] < broad[2], 'dao động rộng vẫn phải thấy rõ');
  });

  test('em chưa kích hoạt tài khoản được nói tách riêng ở chân bảng', () => {
    const n = perf({ items: [P({ activated: false })], assignment_count: 4 });
    assert.match(n['perf-foot'].innerHTML, /chưa kích hoạt tài khoản/);
  });

  test('tên học viên được thoát HTML', () => {
    const n = perf({ items: [P({ name: '<script>x</script>' })], assignment_count: 1 });
    assert.doesNotMatch(n['perf-rows'].innerHTML, /<script>/);
  });

  test('mở tab Tiến độ là gọi CẢ hai nguồn, và chúng không chờ nhau', () => {
    // Một bên hỏng không được kéo bên kia biến mất theo.
    // Chốt `_progressLoaded` nay là một `if` LỒNG trong nhánh `progress` (bảng
    // bài hằng ngày phải gọi được ngoài chốt để lần hỏng còn thử lại), nên neo
    // theo nhánh chứ không theo chuỗi điều kiện cũ.
    const sw = SRC.slice(SRC.indexOf("if (name === 'progress')"));
    assert.match(sw, /loadProgress\(\);[\s\S]{0,400}?loadSpeakingPerf\(\);/);
    assert.doesNotMatch(sw.slice(0, 400), /await loadProgress/);
  });
});


// ── Giao bài tập theo buổi (giáo trình) ──────────────────────────────────────

describe('giao bài tập theo buổi', () => {
  function pickers(skill) {
    const p = load({ kind: 'daily' });
    p.nodes['hf-skill'].value = skill;
    p.applyHomeworkKind();
    return p;
  }

  test('chọn "Bài tập theo buổi" thì hiện ô kho giáo trình', () => {
    const p = pickers('course');
    assert.equal(p.nodes['hf-cbank-field'].hidden, false);
  });

  test('và ẩn ô đề Reading/Listening — hai kho khác nhau', () => {
    // Bank giáo trình không nằm trong thư viện đề; để cả hai cùng hiện là mời
    // giáo viên chọn nhầm rồi bị backend từ chối.
    const p = pickers('course');
    assert.equal(p.nodes['hf-test-field'].hidden, true);
    assert.equal(p.nodes['hf-topic-field'].hidden, true);
  });

  test('chọn Reading thì ô kho giáo trình ẩn lại', () => {
    const p = pickers('reading');
    assert.equal(p.nodes['hf-cbank-field'].hidden, true);
    assert.equal(p.nodes['hf-test-field'].hidden, false);
  });

  test('buổi đã giao và buổi chưa nạp câu hỏi bị ẩn, kèm LÝ DO TÁCH RIÊNG', async () => {
    // Hai việc khác nhau: một cái đã xong, một cái là nạp tệp JSONL của buổi ấy.
    const p = load({ kind: 'daily', banks: [
      { id: 'b1', lesson_no: 1, title: 'Buổi 1', question_count: 100, already_given: false, ready: true },
      { id: 'b2', lesson_no: 2, title: 'Buổi 2', question_count: 100, already_given: true, ready: true },
      { id: 'b3', lesson_no: 3, title: 'Buổi 3', question_count: 0, already_given: false, ready: false },
    ] });
    p.nodes['hf-skill'].value = 'course';
    await p.loadCourseBanks();
    assert.match(p.nodes['hf-cbank'].innerHTML, /Buổi 1/);
    assert.doesNotMatch(p.nodes['hf-cbank'].innerHTML, /Buổi 2/);
    assert.doesNotMatch(p.nodes['hf-cbank'].innerHTML, /Buổi 3/);
    const note = p.nodes['hf-cbank-note'].textContent;
    assert.match(note, /1 buổi lớp này đã làm/);
    assert.match(note, /1 buổi chưa nạp câu hỏi/);
  });

  test('bank thiếu audio hoặc bộ phát âm bị chặn với lý do vận hành rõ ràng', async () => {
    const p = load({ kind: 'daily', banks: [
      { id: 'b1', lesson_no: 1, title: 'Buổi 1', question_count: 100,
        already_given: false, ready: false, missing_audio: 3,
        pronunciation_required: false, pronunciation_ready: false },
      { id: 'b2', lesson_no: 2, title: 'Buổi 2', question_count: 100,
        already_given: false, ready: false, missing_audio: 0,
        pronunciation_required: true, pronunciation_ready: false },
    ] });
    p.nodes['hf-skill'].value = 'course';
    await p.loadCourseBanks();
    assert.doesNotMatch(p.nodes['hf-cbank'].innerHTML, /Buổi 1|Buổi 2/);
    assert.match(p.nodes['hf-cbank-note'].textContent, /1 buổi thiếu audio câu tiếng Anh/);
    assert.match(p.nodes['hf-cbank-note'].textContent, /1 buổi thiếu bộ phát âm/);
    assert.equal(p.nodes['hf-cbank-note'].dataset.tone, 'warn');
  });

  test('gửi đi payload GỌN — bộ đề quyết định tất cả', async () => {
    const p = load({ kind: 'daily' });
    p.nodes['hf-skill'].value = 'course';
    p.nodes['hf-cbank'].value = 'b1';
    p.nodes['hf-due'].value = '2026-08-11';
    await p.submitCourseHomework('Bài tập buổi 1');
    assert.equal(p.posted.length, 1);
    const b = p.posted[0].body;
    assert.equal(b.skill, 'course');
    assert.equal(b.content_id, 'b1');
    assert.equal(b.due_date, '2026-08-11');
    // Không có mode/part/question_ids: đòi chúng là đòi thông tin không tồn tại.
    assert.ok(!('mode' in b) && !('part' in b) && !('question_ids' in b));
    // Ngưỡng bỏ trống thì VẮNG MẶT — không phải null. Vắng mặt mới đúng nghĩa
    // "theo mặc định hiện hành", và mặc định được phép tiến hoá.
    assert.ok(!('pass_pct' in b) && !('retake_size' in b));
  });

  test('điền ngưỡng đạt / cỡ mẫu kiểm tra lại thì đi theo payload', async () => {
    const p = load({ kind: 'daily' });
    p.nodes['hf-skill'].value = 'course';
    p.nodes['hf-cbank'].value = 'b1';
    p.nodes['hf-due'].value = '2026-08-11';
    p.nodes['hf-pass-pct'].value = '90';
    p.nodes['hf-retake-size'].value = '15';
    await p.submitCourseHomework('Bài tập buổi 1');
    assert.equal(p.posted.length, 1);
    assert.equal(p.posted[0].body.pass_pct, 90);
    assert.equal(p.posted[0].body.retake_size, 15);
  });

  test('ngưỡng ngoài dải bị chặn tại chỗ, không tốn vòng gọi mạng', async () => {
    const p = load({ kind: 'daily' });
    p.nodes['hf-skill'].value = 'course';
    p.nodes['hf-cbank'].value = 'b1';
    p.nodes['hf-pass-pct'].value = '45';      // dưới sàn 50
    await p.submitCourseHomework('Bài');
    assert.equal(p.posted.length, 0);
    assert.match(p.nodes['hf-error'].textContent, /50–100/);
  });

  test('chưa chọn buổi thì chặn tại chỗ, không tốn một vòng gọi mạng', async () => {
    const p = load({ kind: 'daily' });
    p.nodes['hf-skill'].value = 'course';
    await p.submitCourseHomework('Bài');
    assert.equal(p.posted.length, 0);
    assert.match(p.nodes['hf-error'].textContent, /Chọn một buổi/);
  });
});
