// Hai biểu đồ Speaking — LỚP CHE DUY NHẤT của chúng.
//
// Cổng parity G1 KHÔNG thấy gì bên trong `<canvas>`. Nghĩa là dù cổng xanh
// tuyệt đối, mọi lỗi chọn-dữ-liệu ở đây vẫn lọt: vẽ nhầm phiên, sắp sai thứ tự
// thời gian, tính trung bình sai. "Cổng xanh" KHÔNG đọc thành "biểu đồ đúng".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CRITERIA_KEYS, LINE_MAX_POINTS, LINE_MIN_POINTS, RADAR_LABELS, RADAR_WINDOW,
  avgCriterion, chartLabels, chartSessions, hasCriteria, radarSessions,
} from '../lib/speaking-charts.mjs';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = readFileSync(path.join(FRONTEND, 'public/pages/speaking.html'), 'utf8');

const S = (over) => ({ status: 'completed', overall_band: 6, started_at: '2026-01-01', ...over });

describe('biểu đồ Speaking — chọn dữ liệu', () => {
  test('chỉ lấy phiên ĐÃ HOÀN THÀNH và CÓ band tổng', () => {
    // `submitted` / `analysis_failed` bị loại: vẽ chúng thành 0 hay bỏ trống
    // đều nói dối — bài đang chờ chấm không phải bài điểm thấp.
    const got = chartSessions([
      S({ started_at: '2026-01-03' }),
      S({ status: 'submitted', overall_band: null, started_at: '2026-01-04' }),
      S({ status: 'analysis_failed', started_at: '2026-01-05' }),
      S({ status: 'completed', overall_band: null, started_at: '2026-01-06' }),
      S({ status: 'in_progress', started_at: '2026-01-07' }),
    ]);
    assert.deepEqual(got.map((s) => s.started_at), ['2026-01-03']);
  });

  test('sắp CŨ → MỚI rồi lấy phần đuôi', () => {
    const got = chartSessions([
      S({ started_at: '2026-03-01' }), S({ started_at: '2026-01-01' }), S({ started_at: '2026-02-01' }),
    ]);
    assert.deepEqual(got.map((s) => s.started_at), ['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  test(`giới hạn ${LINE_MAX_POINTS} điểm, GIỮ mới nhất`, () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      S({ started_at: `2026-01-${String(i + 1).padStart(2, '0')}` }));
    const got = chartSessions(many);
    assert.equal(got.length, LINE_MAX_POINTS);
    assert.equal(got.at(-1).started_at, '2026-01-30', 'phải giữ MỚI nhất, không phải cũ nhất');
    assert.match(LEGACY, new RegExp('slice\\(-' + LINE_MAX_POINTS + '\\)'));
  });

  test('nhãn trục X `dd/mm` có đệm số 0', () => {
    assert.deepEqual(chartLabels([S({ started_at: '2026-03-07T10:00:00' })]), ['07/03']);
  });

  test('4 đường tiêu chí chỉ vẽ khi CÓ dữ liệu tiêu chí', () => {
    assert.equal(hasCriteria([S({})]), false);
    assert.equal(hasCriteria([S({ band_p: 5 })]), true);
    assert.equal(hasCriteria([]), false);
  });

  test(`radar lấy ${RADAR_WINDOW} phiên gần nhất CÓ tiêu chí`, () => {
    const mixed = Array.from({ length: 8 }, (_, i) =>
      S({ started_at: `2026-01-0${i + 1}`, band_fc: i % 2 === 0 ? 6 : null }));
    const got = radarSessions(chartSessions(mixed));
    assert.ok(got.length <= RADAR_WINDOW);
    assert.ok(got.every((s) => CRITERIA_KEYS.some((k) => s[k] != null)),
      'phiên không có tiêu chí nào không được vào radar');
  });

  test('trung bình BỎ QUA null, không coi là 0', () => {
    // Một phiên không chấm Pronunciation KHÔNG có nghĩa phát âm 0 điểm — coi
    // null là 0 sẽ kéo tụt cả hình radar.
    assert.equal(avgCriterion([{ band_fc: 6 }, { band_fc: null }, { band_fc: 7 }], 'band_fc'), 6.5);
    assert.equal(avgCriterion([{ band_fc: null }], 'band_fc'), 0, 'không có gì ⇒ 0 để radar vẽ được');
    assert.equal(avgCriterion([{ band_fc: 6 }, { band_fc: 6.1 }, { band_fc: 6.3 }], 'band_fc'), 6.1,
      'làm tròn 1 chữ số thập phân');
  });

  test('ngưỡng + nhãn radar trùng legacy', () => {
    assert.equal(LINE_MIN_POINTS, 2);
    assert.match(LEGACY, /completed\.length < 2/);
    assert.match(LEGACY, new RegExp('slice\\(-' + RADAR_WINDOW + '\\)'));
    for (const label of RADAR_LABELS) {
      assert.ok(LEGACY.includes(label.replace('\n', '\\n')),
        `nhãn radar «${label.replace('\n', ' ')}» không còn trong legacy`);
    }
    assert.deepEqual(CRITERIA_KEYS, ['band_fc', 'band_lr', 'band_gra', 'band_p']);
  });

  test('thiếu Chart.js thì KHÔNG dựng khối rỗng', () => {
    // Khối rỗng nói "bạn chưa có dữ liệu" — một câu SAI khi thật ra chỉ là thư
    // viện chưa nạp xong (nó `defer` từ CDN).
    const src = readFileSync(
      path.join(FRONTEND, 'app/(authed-speaking)/speaking-preview/speaking-charts.ts'), 'utf8');
    assert.match(src, /if \(typeof Chart !== 'function'\) return;/);
    // So TRONG PHẠM VI `renderCharts`: `indexOf('showEmpty(')` trên cả tệp sẽ
    // bắt ĐỊNH NGHĨA hàm ở đầu tệp chứ không phải lời gọi (đã dính một lần).
    const body = src.slice(src.indexOf('export function renderCharts'));
    const guard = body.indexOf("typeof Chart !== 'function'");
    const firstCall = body.indexOf('showEmpty(');
    assert.ok(guard >= 0 && firstCall > guard,
      'phải thoát TRƯỚC lời gọi showEmpty đầu tiên trong renderCharts');
  });
});
