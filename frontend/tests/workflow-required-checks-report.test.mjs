// Check BẮT BUỘC của staging phải LUÔN báo về, kể cả trên PR chỉ sửa spec/docs.
//
// VÌ SAO CÓ CHỐT NÀY: 2026-10-29 staging bật branch protection với 8 check bắt
// buộc. `backend-tests.yml` khi đó lọc `pull_request` bằng `paths:`, nên trên PR
// chỉ sửa spec/docs (#1930, #1935, #1946, #1947) workflow không chạy, check
// không bao giờ báo về và GitHub CHẶN merge. Bộ lọc giờ là job `changes`; job
// nặng SKIP (skip = đạt check bắt buộc). Hai bẫy dễ tái phát:
//   · thêm lại `paths:` vào trigger → check lại treo;
//   · skip job matrix ở mức job → GitHub báo một check tên CHƯA NỞ
//     (`… ${{ matrix.shard }}/4`), 4 check «shard N/4» treo mãi.
// Required checks must always report; this pins both traps.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8');

// Tên phải TRÙNG KHÍT với branch protection của staging (không đổi tên check).
const REQUIRED = {
  'backend-tests.yml': [
    'Backend pytest collection + anchor drift',
    'Backend pytest shard ${{ matrix.shard }}/4',
    'Frontend (node --test)',
  ],
  'typecheck.yml': ['TypeScript strict + legacy JSDoc', 'api.d.ts ↔ OpenAPI drift'],
};

const code = (src) => src.split('\n').filter((l) => !/^\s*#/.test(l));

/** Thân trigger `pull_request:` (các dòng thụt sâu hơn nó), đã bỏ chú thích. */
function pullRequestTrigger(src) {
  const lines = code(src);
  const i = lines.findIndex((l) => /^ {2}pull_request:\s*$/.test(l));
  assert.ok(i >= 0, 'không thấy trigger pull_request');
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (/^ {0,2}\S/.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
}

/** Job theo khoá: { key → các dòng của job } (khoá thụt 2 dấu cách dưới `jobs:`). */
function jobs(src) {
  const lines = code(src);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const out = {};
  let key = null;
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}([\w-]+):\s*$/.exec(l);
    if (m) { key = m[1]; out[key] = []; continue; }
    if (key) out[key].push(l);
  }
  return out;
}

const jobLevel = (body, k) => body.find((l) => new RegExp(`^ {4}${k}:`).test(l));

describe('check bắt buộc của staging luôn báo về', () => {
  for (const [file, names] of Object.entries(REQUIRED)) {
    test(`${file} — không lọc đường dẫn ở trigger pull_request`, () => {
      assert.doesNotMatch(pullRequestTrigger(read(file)), /^\s*paths(-ignore)?:/m,
        'bộ lọc `paths` ở trigger làm check bắt buộc treo trên PR chỉ sửa docs — '
        + 'lọc trong job `changes` thay vì ở trigger');
    });

    test(`${file} — tên check bắt buộc không đổi`, () => {
      const declared = Object.values(jobs(read(file)))
        .map((b) => jobLevel(b, 'name')?.replace(/^ {4}name:\s*/, '').trim());
      for (const n of names) assert.ok(declared.includes(n), `mất check bắt buộc: ${n}`);
    });
  }

  test('backend-tests.yml — job nặng skip theo `changes`, matrix thì không skip ở mức job', () => {
    const j = jobs(read('backend-tests.yml'));
    assert.ok(j.changes, 'thiếu job `changes`');
    const gate = "(github.event_name == 'push' || needs.changes.outputs.run_tests != 'false')";
    for (const key of ['backend-collect', 'frontend']) {
      assert.match(jobLevel(j[key], 'needs') ?? '', /changes/, `${key} phải needs: changes`);
      const cond = jobLevel(j[key], 'if') ?? '';
      // `!cancelled()`: `changes` hỏng ⇒ output rỗng ⇒ job nặng VẪN chạy (fail closed).
      assert.ok(cond.includes('!cancelled()') && cond.includes(gate), `${key}: if sai — ${cond}`);
    }

    const shard = j['backend-shard'];
    assert.match(jobLevel(shard, 'name'), /\$\{\{ matrix\.shard \}\}/);
    assert.equal(jobLevel(shard, 'if')?.trim(), 'if: ${{ !cancelled() }}',
      'job matrix không được skip ở mức job: tên check sẽ không nở');
    assert.ok(shard.some((l) => l.includes(`RUN_TESTS: \${{ ${gate} }}`)), 'thiếu RUN_TESTS');
    // Cùng cổng cho service Postgres: lệch thì shard chạy test mà không có PG.
    assert.ok(shard.some((l) => l.includes(`image: \${{ ${gate} && 'postgres:16' || '' }}`)),
      'image Postgres phải theo đúng cổng RUN_TESTS');
    // Mọi step trừ dòng báo «bỏ qua» đều phải gác bằng RUN_TESTS.
    const steps = shard.join('\n').split(/\n {6}- /).slice(1);
    assert.ok(steps.length >= 6, `chỉ thấy ${steps.length} step`);
    for (const s of steps) {
      assert.match(s, /\n {8}if: .*env\.RUN_TESTS [!=]= 'true'/, `step không gác: ${s.split('\n')[0]}`);
    }
  });
});
