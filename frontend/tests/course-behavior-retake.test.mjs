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
  test('không vẽ đạt hoặc không đạt khi vẫn còn phần bắt buộc', () => {
    assert.match(SRC, /v\.completed === false/);
    assert.match(SRC, /chỉ kết luận đạt hoặc chưa đạt sau khi đủ tất cả các phần/);
    assert.match(SRC, /cx-section-checklist/);
    assert.match(SRC, /sectionRows\.filter/);
  });

  test('chỉ mở hành động cho phần chưa hoàn thành', () => {
    for (const key of ['writingDone', 'readingDone', 'listeningDone', 'pronunciationDone']) {
      assert.match(SRC, new RegExp(`!${key}`));
    }
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
