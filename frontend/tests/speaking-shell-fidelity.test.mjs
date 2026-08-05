// Vỏ Next của trang Speaking phải là phép CHÉP TRUNG THỰC từ bản legacy.
//
// VÌ SAO CẦN TEST NÀY THAY VÌ DỰA VÀO CỔNG PARITY: cổng authed cần một cặp
// legacy ↔ Next mà cả hai vế đều dựng đủ. Vỏ chưa có tầng hành vi (1736 dòng JS
// nội tuyến, chia làm hai PR sau), nên thêm cặp vào cổng lúc này sẽ khiến nó đỏ
// suốt hai PR — tức PR không merge được, và cám dỗ là allow-list các khác biệt
// THẬT để ép xanh. Cổng tự cấp phép còn tệ hơn không có cổng.
//
// Nên PR vỏ tự gác bằng thứ kiểm được OFFLINE: mọi `id`, mọi class, mọi đoạn
// chữ hiển thị của bản legacy phải có mặt trong vỏ. Cặp parity thật sẽ vào ở PR
// hành vi cuối cùng.
//
// ID QUAN TRỌNG NHẤT: tầng hành vi (PR sau) với tay vào DOM theo id — đúng như
// `home-behavior.tsx` đang làm. Trang này có 89 id; mất một cái là hỏng một
// tính năng mà build vẫn xanh.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_FILE = path.join(FRONTEND, 'public/pages/speaking.html');
const SHELL_FILE = path.join(FRONTEND, 'app/(authed-speaking)/speaking/page-shell.tsx');

/** Phần `<body>` của bản legacy, đã bỏ script/style/chú thích. */
function legacyBody() {
  const src = readFileSync(LEGACY_FILE, 'utf8');
  let body = /<body[^>]*>([\s\S]*?)<\/body>/.exec(src)[1];
  body = body.replace(/<script[\s\S]*?<\/script>/g, '');
  body = body.replace(/<style[\s\S]*?<\/style>/g, '');
  return body.replace(/<!--[\s\S]*?-->/g, '');
}

/** Thân JSX của vỏ, đã bỏ chú thích. */
function shellBody() {
  const src = readFileSync(SHELL_FILE, 'utf8');
  return src.slice(src.indexOf('return (')).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** Đoạn chữ hiển thị — bỏ thẻ, bỏ biểu thức JSX, gộp khoảng trắng. */
function visibleText(src, { jsx = false } = {}) {
  let s = src.replace(/<[^>]+>/g, ' ');
  if (jsx) s = s.replace(/\{[^{}]*\}/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return new Set(s.split(/\s{2,}|\n/).map((x) => x.trim()).filter((x) => x.length > 2));
}

const LEGACY = legacyBody();
const SHELL = shellBody();

describe('vỏ Speaking — trung thực với bản legacy', () => {
  test('giữ ĐỦ mọi id (tầng hành vi với tay vào DOM theo id)', () => {
    const lids = new Set([...LEGACY.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const sids = new Set([...SHELL.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(lids.size >= 80, `legacy phải có ~89 id, đếm được ${lids.size} — regex hỏng?`);
    assert.deepEqual([...lids].filter((x) => !sids.has(x)), [],
      'thiếu id ⇒ tầng hành vi sẽ im lặng không tìm thấy phần tử');
  });

  test('giữ ĐỦ mọi class (cascade CSS bám vào class — bài học pilot 2 #741)', () => {
    const cls = (re, src) => new Set(
      [...src.matchAll(re)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
    const l = cls(/\bclass="([^"]+)"/g, LEGACY);
    const s = cls(/className="([^"]+)"/g, SHELL);
    assert.ok(l.size >= 140, `legacy phải có ~148 class, đếm được ${l.size} — regex hỏng?`);
    assert.deepEqual([...l].filter((x) => !s.has(x)), [],
      'thiếu class ⇒ trang vẫn dựng nhưng mất style, và build không báo gì');
  });

  test('giữ ĐỦ mọi đoạn chữ hiển thị', () => {
    const l = visibleText(LEGACY);
    const s = visibleText(SHELL, { jsx: true });
    assert.ok(l.size >= 100, `legacy phải có ~108 đoạn chữ, đếm được ${l.size} — regex hỏng?`);
    assert.deepEqual([...l].filter((x) => !s.has(x)), [],
      'thiếu chữ ⇒ cổng parity sẽ báo line-missing khi cặp được thêm ở PR hành vi');
  });

  test('vỏ KHÔNG mang handler nội tuyến (chúng thuộc tầng hành vi)', () => {
    // Bản legacy có 27 handler nội tuyến; đo được 0/27 cái ĐIỀU HƯỚNG, mà
    // `hrefFromInlineHandler` (parity-core.mjs) chỉ trích điều hướng — nên cổng
    // parity mù với cả 27. Chúng sẽ được gắn bằng listener theo id ở PR hành vi,
    // giống khuôn `home-behavior.tsx`. Để lẫn vào vỏ là trộn hai loại lỗi.
    const inline = [...SHELL.matchAll(/\son[a-z]+=/gi)].map((m) => m[0].trim());
    assert.deepEqual(inline, [], 'handler nội tuyến phải nằm ở tầng hành vi');
  });

  test('vỏ là fragment, không tự dựng <body> (bài học review #741)', () => {
    assert.ok(!SHELL.includes('<body'), 'layout gốc mới sở hữu <body>');
    assert.ok(!SHELL.includes("'use client'"), 'vỏ phải là Server Component');
  });
});
