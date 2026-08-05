// Hai biểu đồ Chart.js của trang Speaking (PR 3b).
//
// KHÔNG PHẢI COMPONENT — chỉ là hàm, do `speaking-stats.tsx` gọi sau khi có dữ
// liệu. Tách tệp vì đây là phần DUY NHẤT của trang mà cổng parity G1 không thấy
// được: nó vẽ vào `<canvas>`, còn G1 so chữ/link/khối. Lớp che của nó là
// `lib/speaking-charts.mjs` + test, không phải cổng.
//
// MÀU LẤY TỪ TOKEN LÚC VẼ, không hardcode: Chart.js nhận màu là chuỗi đã tính,
// nó không hiểu `var(--av-*)`. Vì vậy đổi theme phải VẼ LẠI — xem
// `observeThemeFlip` ở cuối tệp.
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import {
  CRITERIA_KEYS, LINE_MIN_POINTS, RADAR_LABELS,
  avgCriterion, chartLabels, chartSessions, hasCriteria, radarSessions,
} from '@/lib/speaking-charts.mjs';
import { roundHalf } from '@/lib/speaking-stats.mjs';

const $ = (id: string) => document.getElementById(id);

/**
 * Giá trị đã TÍNH của một biến CSS.
 *
 * `getPropertyValue` giữ khoảng trắng đầu từ khai báo gốc nên phải `trim`.
 * Fallback `#888` để một token bị đổi tên không làm cả biểu đồ biến mất.
 */
function tokenColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

type Charts = { line: any; radar: any };
const charts: Charts = { line: null, radar: null };
let lastSessions: any[] | null = null;

function destroy(which: keyof Charts) {
  if (charts[which]) {
    charts[which].destroy();
    charts[which] = null;
  }
}

/** Bật khối "chưa đủ dữ liệu" và huỷ biểu đồ tương ứng. */
function showEmpty(wrapId: string, emptyId: string, which: keyof Charts) {
  $(wrapId)?.classList.add('hidden');
  $(emptyId)?.classList.remove('hidden');
  destroy(which);
}

export async function renderCharts(sessions: any[]) {
  // NHỚ dữ liệu TRƯỚC mọi lối thoát. Bản đầu `return` ngay khi chưa có Chart.js
  // và chưa kịp gán `lastSessions`, nên KHÔNG đường nào cứu được: người dùng có
  // dữ liệu hợp lệ mà biểu đồ không bao giờ hiện, cho tới lần fetch sau hoặc
  // một cú lật theme. Đúng lớp lỗi mất-tính-năng-chập-chờn của pilot 2 — chỉ
  // xảy ra khi CDN chậm hơn `/api/dashboard/init`, nên chạy thử thường không
  // thấy. (Codex bắt ở PR #938.)
  lastSessions = sessions;

  // Chart.js nạp `defer` từ CDN ⇒ CHỜ có hạn giờ thay vì kiểm một lần rồi bỏ.
  // Quá hạn thì `whenGlobalReady` tự báo lên telemetry và ta thoát IM LẶNG —
  // KHÔNG dựng khối rỗng, vì khối rỗng nói "bạn chưa có dữ liệu", một câu SAI
  // khi thật ra chỉ là thư viện chưa tới.
  const ready = await whenGlobalReady(
    () => typeof (window as any).Chart === 'function', 'Chart.js (speaking)',
  );
  if (!ready) return;
  const Chart = (window as any).Chart;

  const completed = chartSessions(sessions);

  const C = {
    textMuted: tokenColor('--av-text-muted'),
    textFaint: tokenColor('--av-text-faint'),
    textPrimary: tokenColor('--av-text-primary'),
    textSecond: tokenColor('--av-text-secondary'),
    borderSub: tokenColor('--av-border-subtle'),
    borderDef: tokenColor('--av-border-default'),
    surfaceElev: tokenColor('--av-surface-elevated'),
    primary: tokenColor('--av-primary'),
    primarySoft: tokenColor('--av-primary-soft'),
  };

  // ── Biểu đồ đường ─────────────────────────────────────────────────────────
  if (completed.length < LINE_MIN_POINTS) {
    showEmpty('line-chart-wrap', 'line-chart-empty', 'line');
  } else {
    $('line-chart-wrap')?.classList.remove('hidden');
    $('line-chart-empty')?.classList.add('hidden');

    const lineDS = (label: string, key: string, color: string, dashed: boolean) => ({
      label,
      data: completed.map((s: any) => (s[key] != null ? s[key] : null)),
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: dashed ? 1.5 : 2.5,
      borderDash: dashed ? [5, 4] : [],
      pointRadius: dashed ? 2 : 4,
      pointHoverRadius: dashed ? 4 : 6,
      pointBackgroundColor: color,
      tension: 0.35,
      // `spanGaps` nối qua điểm thiếu — một phiên không chấm tiêu chí không
      // được cắt đứt đường của các phiên còn lại.
      spanGaps: true,
    });

    const overall = lineDS('Tổng (Overall)', 'overall_band', C.primary, false);
    overall.borderWidth = 3.5;
    overall.pointRadius = 5;
    overall.pointHoverRadius = 7;

    const datasets: any[] = [overall];
    if (hasCriteria(completed)) {
      // Bốn màu tiêu chí là HẰNG SỐ, không phải token: chúng phải phân biệt
      // được với nhau ở cả hai theme, còn token primary thì đổi theo theme.
      datasets.push(
        lineDS('FC', 'band_fc', '#38bdf8', true),
        lineDS('LR', 'band_lr', '#fb923c', true),
        lineDS('GRA', 'band_gra', '#a78bfa', true),
        lineDS('P', 'band_p', '#ef4444', true),
      );
    }

    const ctx = ($('chart-line') as HTMLCanvasElement | null)?.getContext('2d');
    if (ctx) {
      destroy('line');
      charts.line = new Chart(ctx, {
        type: 'line',
        data: { labels: chartLabels(completed), datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            // Trục 0–9 CỐ ĐỊNH: để Chart.js tự co trục sẽ phóng đại một dao
            // động 0.5 band thành cả biểu đồ.
            y: {
              min: 0,
              max: 9,
              ticks: { stepSize: 1, color: C.textMuted, font: { size: 11 } },
              grid: { color: C.borderSub },
              border: { color: C.borderSub },
            },
            x: {
              ticks: { color: C.textMuted, font: { size: 11 }, maxRotation: 0 },
              grid: { display: false },
              border: { color: C.borderSub },
            },
          },
          plugins: {
            legend: {
              labels: {
                color: C.textSecond, boxWidth: 10, boxHeight: 10,
                font: { size: 11 }, padding: 14,
              },
            },
            tooltip: {
              backgroundColor: C.surfaceElev,
              titleColor: C.textSecond,
              bodyColor: C.textPrimary,
              borderColor: C.borderDef,
              borderWidth: 1,
              callbacks: {
                label: (c: any) => c.dataset.label + ': '
                  + (c.raw != null ? roundHalf(c.raw).toFixed(1) : '—'),
              },
            },
          },
        },
      });
    }
  }

  // ── Biểu đồ radar ─────────────────────────────────────────────────────────
  const last5 = radarSessions(completed);
  if (last5.length === 0) {
    showEmpty('radar-chart-wrap', 'radar-chart-empty', 'radar');
    return;
  }
  $('radar-chart-wrap')?.classList.remove('hidden');
  $('radar-chart-empty')?.classList.add('hidden');

  const ctx = ($('chart-radar') as HTMLCanvasElement | null)?.getContext('2d');
  if (!ctx) return;
  destroy('radar');
  charts.radar = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: RADAR_LABELS,
      datasets: [{
        label: 'Band trung bình',
        data: CRITERIA_KEYS.map((k: string) => avgCriterion(last5, k)),
        backgroundColor: C.primarySoft,
        borderColor: C.primary,
        borderWidth: 2,
        pointBackgroundColor: C.primary,
        pointBorderColor: C.surfaceElev,
        pointBorderWidth: 1.5,
        pointRadius: 4,
        pointHoverRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 9,
          ticks: {
            stepSize: 3, color: C.textFaint, font: { size: 10 },
            backdropColor: 'transparent',
          },
          grid: { color: C.borderDef },
          angleLines: { color: C.borderDef },
          pointLabels: { color: C.textSecond, font: { size: 11 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: C.surfaceElev,
          bodyColor: C.textPrimary,
          borderColor: C.borderDef,
          borderWidth: 1,
          callbacks: {
            label: (c: any) => c.label.replace('\n', ' ') + ': ' + roundHalf(c.raw).toFixed(1),
          },
        },
      },
    },
  });
}

/**
 * Vẽ lại khi ĐỔI THEME.
 *
 * Bắt buộc, không phải trang trí: màu đã được tính thành chuỗi lúc vẽ, nên sau
 * khi lật theme trục/lưới/tooltip vẫn giữ màu cũ và có thể thành chữ đen trên
 * nền đen. Bản legacy làm y hệt bằng một `MutationObserver` trên
 * `<html data-theme>` gọi `window._dashboard.refreshCharts`; ở đây không phơi
 * gì ra window — người gọi giữ hàm dọn.
 */
export function observeThemeFlip(): () => void {
  const html = document.documentElement;
  let last = html.getAttribute('data-theme');
  const mo = new MutationObserver(() => {
    const t = html.getAttribute('data-theme');
    if (t === last) return;
    last = t;
    if (lastSessions) renderCharts(lastSessions);
  });
  mo.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

/** Dọn khi rời trang — Chart.js giữ canvas và listener resize. */
export function destroyCharts() {
  destroy('line');
  destroy('radar');
  lastSessions = null;
}
