/**
 * Làm kiểm tra lại phải DỌN báo cáo của lượt trước.
 *
 * Báo cáo mức một nói "chi tiết từng câu còn khoá". Làm kiểm tra lại rồi ĐẠT
 * thì dòng ấy sai — nhưng nó nằm ở một khung khác nên không ai vẽ lại, và màn
 * hình vừa nói "Đã ĐẠT" vừa nói "còn khoá" (codex #968).
 *
 * Chốt CHẠY khối điều khiển thật, không soi chữ: trích `startRetakeFlow` ra rồi
 * gọi nó với phụ kiện giả. Ghim tên hàm mà quên ghim hành vi thì một lần đổi
 * thứ tự hai dòng vẫn xanh.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(
  new URL('../app/(authed)/course-exercises/course-behavior.tsx', import.meta.url), 'utf8');
const SHELL = readFileSync(
  new URL('../app/(authed)/course-exercises/page-shell.tsx', import.meta.url), 'utf8');

function functionBody(name) {
  const marker = `function ${name}`;
  const i = SRC.indexOf(marker);
  assert.ok(i !== -1, `không thấy ${name}`);
  const open = SRC.indexOf('{', i);
  let depth = 0;
  for (let k = open; k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}' && --depth === 0) return SRC.slice(open + 1, k);
  }
  throw new Error(`không đóng được ${name}`);
}

function loadRetakeFlow() {
  const i = SRC.indexOf('async function startRetakeFlow() {');
  assert.ok(i !== -1, 'không thấy startRetakeFlow');
  // Cắt tới dấu đóng ngoặc của chính hàm: đếm ngoặc, không đoán bằng chuỗi kết.
  let depth = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}' && --depth === 0) { j = k + 1; break; }
  }
  const body = SRC.slice(i, j).replace(/^\s*async function startRetakeFlow\(\)\s*\{/, '')
    .replace(/\}$/, '');
  return (env) => {
    const fn = new Function('$', 'lastVerdict', 'runner', 'renderQuestion', 'esc', 'setSaveState',
      'reportSeq', 'reportLoad',
      `return (async () => {${body}})();`);
    return fn(env.$, env.lastVerdict, env.runner, env.renderQuestion,
      env.esc || ((value) => String(value)), env.setSaveState || (() => {}), 0, null);
  };
}

function loadReportFlow(env) {
  const marker = 'async function showReport(options: { scroll?: boolean } = {}) {';
  const i = SRC.indexOf(marker);
  assert.ok(i !== -1, 'không thấy showReport');
  const open = i + marker.length - 1;
  let depth = 0, close = open;
  for (let k = open; k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}' && --depth === 0) { close = k; break; }
  }
  const body = SRC.slice(open + 1, close)
    .replace(/catch \(err: any\)/g, 'catch (err)')
    .replace(/bankId!/g, 'bankId');
  const factory = new Function(
    '$', 'setActiveSection', 'CR', 'api', 'bankId', 'runner',
    'requestedItem', 'lastVerdict', 'esc',
    `let reportLoad = null;
     let reportSeq = 0;
     return async function showReport(options = {}) {${body}};`,
  );
  return factory(
    env.$, env.setActiveSection || (() => {}), env.CR, env.api, 'bank-1',
    env.runner || { reviewOnly: false }, null, env.lastVerdict || { passed: true, pct: 80 },
    (value) => String(value),
  );
}

describe('làm kiểm tra lại', () => {
  test('dọn báo cáo của lượt trước', async () => {
    const run = loadRetakeFlow();
    const rep = {
      hidden: false,
      innerHTML: '<p>chi tiết từng câu còn khoá</p>',
      dataset: { crReady: '1' },
    };
    await run({
      $: (id) => (id === 'cx-report' ? rep : null),
      lastVerdict: { retake_size: 5 },
      runner: { mastery: {}, startRetake: async () => {} },
      renderQuestion: () => {},
    });
    assert.equal(rep.innerHTML, '', 'để lại bảng cũ là nói sai về lượt vừa làm');
    assert.equal(rep.hidden, true);
    assert.equal(rep.dataset.crReady, undefined, 'không được tái dùng cache báo cáo của lượt cũ');
  });

  test('không có khung báo cáo thì vẫn chạy được', async () => {
    // Trang có thể chưa vẽ khung ấy. Ném ở đây là chặn em ấy khỏi bài kiểm tra
    // lại vì một thứ chỉ để trang trí.
    const run = loadRetakeFlow();
    let started = 0;
    await run({
      $: () => null,
      lastVerdict: null,
      runner: { mastery: { retake_size: 7 }, startRetake: async () => { started += 1; } },
      renderQuestion: () => {},
    });
    assert.equal(started, 1);
  });

  test('cỡ mẫu lấy từ kết luận vừa xét, rồi mới tới cấu hình bài', async () => {
    const run = loadRetakeFlow();
    let size = null;
    await run({
      $: () => null,
      lastVerdict: { retake_size: 5 },
      runner: { mastery: { retake_size: 20 }, startRetake: async (n) => { size = n; } },
      renderQuestion: () => {},
    });
    assert.equal(size, 5, 'kết luận vừa xét mới là con số của lượt này');
  });

  test('server không cho mở retake thì không để học viên làm 20 câu vô ích', async () => {
    const run = loadRetakeFlow();
    const verdict = { innerHTML: '' };
    let rendered = 0;
    await run({
      $: (id) => (id === 'cx-verdict' ? verdict : null),
      lastVerdict: { retake_size: 20 },
      runner: {
        mastery: {}, sessionFailed: true,
        persistError: 'Lượt gần nhất không thuộc mức gần đạt',
        startRetake: async () => {},
      },
      renderQuestion: () => { rendered += 1; },
    });
    assert.equal(rendered, 0);
    assert.match(verdict.innerHTML, /không thuộc mức gần đạt/i);
  });
});

describe('nạp phần tự review', () => {
  test('báo cáo stale không bị cache và cú bấm sau thay bằng bản đầy đủ', async () => {
    const box = {
      hidden: true,
      innerHTML: '',
      dataset: {},
      scrollIntoView: () => {},
    };
    const responses = [
      { stale: true, questions: [{ qid: 'q1' }] },
      { stale: false, questions: [{ qid: 'q1' }, { qid: 'q2' }] },
    ];
    let calls = 0;
    const showReport = loadReportFlow({
      $: (id) => id === 'cx-report' ? box : null,
      api: { get: async () => responses[calls++] },
      CR: {
        renderReport: (d) => d.stale ? 'bản đọc thiếu' : 'bản đầy đủ',
        bindReport: () => {},
      },
    });

    await showReport({ scroll: false });
    assert.equal(calls, 1);
    assert.equal(box.innerHTML, 'bản đọc thiếu');
    assert.equal(box.dataset.crReady, undefined);

    await showReport({ scroll: false });
    assert.equal(calls, 2, 'cú bấm sau phải gọi API lại');
    assert.equal(box.innerHTML, 'bản đầy đủ');
    assert.equal(box.dataset.crReady, '1');
  });
});

describe('kết luận gọi đúng lượt đã giúp học viên đạt', () => {
  const label = new Function('v', functionBody('passingAttemptLabel'));

  test('revision cũ đã fail không được nhận công cho full retry đạt', () => {
    assert.equal(label({ phase: 'run', retakes: 1 }), ' · đạt ở full session');
  });

  test('chỉ current phase retake mới được gọi là đạt ở revision', () => {
    assert.equal(label({ phase: 'retake', retakes: 2 }), ' · đạt ở revision lần 2');
  });
});

describe('cổng hoàn thành bài nhiều phần', () => {
  test('dòng mô tả đếm đủ mọi câu thay vì chỉ nói có một bài đọc/nghe', () => {
    const body = functionBody('renderTitleMeta');
    const titleMeta = { textContent: '' };
    const render = new Function(
      'runner', 'titleMeta', 'quizCount', 'writingCount',
      'readingCount', 'listeningCount',
      'pronunciationCount', body,
    );
    const runner = {};

    render(runner, titleMeta, 90, 10, 10, 20, 0);
    assert.equal(
      titleMeta.textContent,
      '130 câu tất cả · 90 câu trắc nghiệm · 10 câu tự luận · 10 câu đọc hiểu · 20 câu nghe hiểu. Trắc nghiệm hiện giải thích ngay sau mỗi câu.',
    );

    render(runner, titleMeta, 90, 10, 10, 20, 12);
    assert.match(titleMeta.textContent, /^142 câu tất cả/);
    assert.match(titleMeta.textContent, /12 câu phát âm/);

    render(runner, titleMeta, 90, 10, 10, 0, 0);
    assert.match(titleMeta.textContent, /^110 câu tất cả/,
      'bài giao cũ không được mọc thêm 20 câu nghe từ bank live');
    assert.doesNotMatch(titleMeta.textContent, /câu nghe hiểu/);
    assert.match(SRC, /assignedSectionCount\('listening', liveListeningCount\)/);
  });

  test('không vẽ đạt hoặc không đạt khi vẫn còn phần bắt buộc', () => {
    assert.match(SRC, /v\.completed === false/);
    assert.match(SRC, /chỉ kết luận đạt hoặc chưa đạt sau khi đủ tất cả các phần/);
    assert.match(SRC, /cx-section-checklist/);
    assert.match(SRC, /sectionRows\.filter/);
  });

  test('phần tự luận và phát âm chỉ mở làm khi chưa hoàn thành', () => {
    for (const key of ['writingDone', 'pronunciationDone']) {
      assert.match(SRC, new RegExp(`!${key}`));
    }
  });

  test('phần đọc và nghe đã hoàn thành vẫn có hành động xem lại', () => {
    const reviewHub = functionBody('renderReviewHub');
    assert.match(SRC, /readingDone \? 'Xem lại bài đọc đã nộp'/);
    assert.match(SRC, /listeningDone \? 'Xem lại bài nghe đã nộp'/);
    assert.match(SRC, /await reading\.review\(\)/);
    assert.match(SRC, /await listening\.review\(\)/);
    assert.match(SRC, /const sectionAssignmentItem = requestedItem \|\| runner\.mastery\?\.item_id \|\| null/);
    assert.match(SRC, /assignmentItemId: sectionAssignmentItem/);
    assert.match(reviewHub, /reviewSectionCompleted\('reading'\)/);
    assert.match(reviewHub, /reviewSectionCompleted\('listening'\)/);
    assert.match(reviewHub, /cx-reading-open/);
    assert.match(reviewHub, /cx-listening-open/);
  });

  test('review hub không suy phần đã nộp từ bank live', () => {
    const reviewHub = functionBody('renderReviewHub');
    assert.doesNotMatch(reviewHub, /\(reading\.exists\s*\?/);
    assert.doesNotMatch(reviewHub, /\(listening\.exists\s*\?/);
    assert.match(SRC, /runner\.mastery\?\.completed_sections/);
    assert.doesNotMatch(reviewHub, /reading\.exists && reviewSectionCompleted/);
    assert.doesNotMatch(reviewHub, /listening\.exists && reviewSectionCompleted/);
  });

  test('không mở phần chỉ mới được thêm vào bank sau lúc giao bài', () => {
    assert.match(SRC, /writingSection && writingReady/);
    assert.match(SRC, /readingSection && reading\.exists/);
    assert.match(SRC, /listeningSection && listening\.exists/);
    assert.match(SRC, /pronunciationSection && pronunciationReady/);
  });

  test('quay lại từ từng phần sẽ đọc lại kết luận canonical', () => {
    assert.match(SRC, /t\.id === 'cr-back'[\s\S]{0,180}renderVerdict\(\)/);
    assert.match(SRC, /t\.id === 'cl-back'[\s\S]{0,180}renderVerdict\(\)/);
  });

  test('làm lại full mở attempt canonical rồi reset mọi phần', () => {
    const body = functionBody('restartFullFlow');
    assert.match(body, /api\.post\('\/api\/quiz\/course\/full-retry'/);
    assert.match(body, /reading\.beginAttempt\(attemptNo\)/);
    assert.match(body, /listening\.beginAttempt\(attemptNo\)/);
    assert.match(body, /writing\.load\(bankId/);
    assert.match(body, /pronunciation\.load\(bankId\)/);
    assert.ok(body.indexOf("/api/quiz/course/full-retry") < body.indexOf('runner.restartFull()'),
      'phải mở sổ attempt trước khi tạo session quiz mới');
  });

  test('409 từ tab cũ mở được full retry thay vì lặp nút Xét lại', () => {
    const body = functionBody('renderVerdict');
    assert.match(body, /message\.includes\('Hãy mở lượt làm lại mới'\)/);
    assert.match(body, /needsFullRetryOpen[\s\S]*id="cx-retry-full"/);
  });

  test('giải thích đúng khi revision Quiz không thể kéo tổng điểm qua ngưỡng', () => {
    assert.match(SRC, /v\.retry_reason === 'section_ceiling'/);
    assert.match(SRC, /Revision Quiz không thể đưa tổng điểm tới ngưỡng/);
    assert.match(SRC, /Quiz revision chỉ thay điểm Quiz; các phần còn lại giữ nguyên/);
    assert.match(SRC, /phần ngoài Quiz nào đang giới hạn điểm tổng/);
  });
});

describe('thời lượng từng phần chỉ tính khi màn đang hiện', () => {
  test('mọi màn chuyển ownership qua một cổng timer duy nhất', () => {
    assert.match(SRC, /setActiveSection\(writing\.submitted \? null : 'writing'\)/);
    assert.match(SRC, /setActiveSection\(reading\.revealed \? null : 'reading'\)/);
    assert.match(SRC, /setActiveSection\(listening\.revealed \? null : 'listening'\)/);
    assert.match(SRC, /setActiveSection\(pronunciation\.completed \? null : 'pronunciation'\)/);
  });

  test('ẩn tab tạm dừng và hiện lại tiếp tục đúng section đang mở', () => {
    const body = functionBody('syncSectionTimers');
    assert.match(body, /pauseSectionTimers\(\)/);
    assert.match(body, /document\.visibilityState === 'hidden'/);
    assert.match(SRC, /onHide = \(\) => \{\s*syncSectionTimers\(\)/);
  });
});

describe('chỉ báo lưu phản ánh persistence thật', () => {
  test('shell bắt đầu trung tính, không khẳng định đã tự động lưu', () => {
    assert.match(SHELL, /id="cx-save-note"[\s\S]*data-state="idle"/);
    assert.match(SHELL, /Sẽ lưu khi hoàn thành chặng/);
    assert.doesNotMatch(SHELL, />Tự động lưu tiến độ</);
  });

  test('state helper cập nhật đồng thời data-state và live-region copy', () => {
    const note = { dataset: {} };
    const text = { textContent: '' };
    const $ = (id) => id === 'cx-save-note' ? note : id === 'cx-save-note-text' ? text : null;
    const setState = new Function('$', 'state', 'message', functionBody('setSaveState'));

    setState($, 'saving');
    assert.equal(note.dataset.state, 'saving');
    assert.equal(text.textContent, 'Đang lưu tiến độ…');
    setState($, 'error');
    assert.equal(note.dataset.state, 'error');
    assert.equal(text.textContent, 'Chưa lưu được tiến độ');
    setState($, 'saved');
    assert.equal(note.dataset.state, 'saved');
    assert.equal(text.textContent, 'Đã lưu tiến độ');
  });

  test('kết quả finishStage là nguồn quyết định saved hay error', () => {
    assert.match(SRC, /setSaveState\(res\.persisted \? 'saved' : 'error'\)/);
    assert.match(SRC, /runner\.sessionFailed \? 'error'/);
  });
});

describe('chuyển chặng trên giao diện', () => {
  function loadAdvanceStageFlow(env) {
    const body = functionBody('advanceStageFlow');
    const factory = new Function('$', 'runner', 'renderQuestion', 'setSaveState', `
      let stageAdvance = null;
      return function advanceStageFlow() {${body}};
    `);
    return factory(env.$, env.runner, env.renderQuestion, env.setSaveState || (() => {}));
  }

  test('double-tap dùng chung một lượt và chỉ render chặng mới một lần', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let advanced = 0;
    let rendered = 0;
    const attrs = new Set();
    const button = {
      isConnected: true,
      setAttribute: (name) => attrs.add(name),
      removeAttribute: (name) => attrs.delete(name),
    };
    const advance = loadAdvanceStageFlow({
      $: (id) => id === 'cx-more' ? button : null,
      runner: { nextStage: () => { advanced += 1; return gate; } },
      renderQuestion: () => { rendered += 1; button.isConnected = false; },
    });

    const first = advance();
    const second = advance();
    assert.strictEqual(second, first);
    assert.equal(advanced, 0, 'promise phải được giữ trước khi gọi runner');
    assert.ok(attrs.has('disabled') && attrs.has('aria-busy'));

    await Promise.resolve();
    assert.equal(advanced, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(rendered, 1, 'render hai lần vẫn để lại cửa cho event cũ chạy lại');
  });
});
