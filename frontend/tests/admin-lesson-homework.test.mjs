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
                failGet = null } = {}) {
  const start = SRC.indexOf(START);
  const end = SRC.indexOf(END);
  assert.ok(start !== -1 && end > start, 'không tìm thấy vùng mã ô giao bài');

  const mk = (extra = {}) => ({ value: '', textContent: '', innerHTML: '',
    hidden: false, disabled: false, dataset: {}, selectedOptions: [{ text: '' }],
    addEventListener() {}, closest: () => null, ...extra });
  const nodes = {};
  for (const id of ['hf-skill-field', 'hf-skill', 'hf-kind-note', 'hf-topic-field',
    'hf-topic', 'hf-topic-note', 'hf-set-field', 'hf-set', 'hf-set-note',
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
