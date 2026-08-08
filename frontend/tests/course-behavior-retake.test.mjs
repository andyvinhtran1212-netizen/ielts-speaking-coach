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
    const fn = new Function('$', 'lastVerdict', 'runner', 'renderQuestion', 'esc',
      `return (async () => {${body}})();`);
    return fn(env.$, env.lastVerdict, env.runner, env.renderQuestion,
      env.esc || ((value) => String(value)));
  };
}

describe('làm kiểm tra lại', () => {
  test('dọn báo cáo của lượt trước', async () => {
    const run = loadRetakeFlow();
    const rep = { hidden: false, innerHTML: '<p>chi tiết từng câu còn khoá</p>' };
    await run({
      $: (id) => (id === 'cx-report' ? rep : null),
      lastVerdict: { retake_size: 5 },
      runner: { mastery: {}, startRetake: async () => {} },
      renderQuestion: () => {},
    });
    assert.equal(rep.innerHTML, '', 'để lại bảng cũ là nói sai về lượt vừa làm');
    assert.equal(rep.hidden, true);
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
