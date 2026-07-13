/* frontend/js/charts/sparkline.js — zero-dependency inline-SVG charts.
 *
 * admin-dashboard-redesign. No React, no chart library (Pattern #15 — lean):
 * the data is tiny (≤90 daily points) and a canvas lib can't read CSS design
 * tokens for light/dark theming. These are PURE functions that return SVG
 * markup strings (no DOM access), so callers inject via innerHTML and the
 * sentinels can assert the output statically.
 *
 * Theme-aware: strokes/fills use `currentColor`, so a parent element's
 * `color: var(--av-primary)` (etc.) themes the chart for both light + dark.
 */
(function () {
  'use strict';

  function _nums(values) {
    return (values || []).map(function (v) {
      var n = (v && typeof v === 'object') ? v.value : v;
      n = Number(n);
      return isFinite(n) ? n : 0;
    });
  }

  // Map values → [x,y] points inside a (w × h) box with `pad` margin. SVG y is
  // top-down, so the line is inverted (max at top).
  function _points(nums, w, h, pad) {
    var min = Math.min.apply(null, nums);
    var max = Math.max.apply(null, nums);
    var span = (max - min) || 1;
    var n = nums.length;
    var innerW = w - pad * 2;
    var innerH = h - pad * 2;
    return nums.map(function (v, i) {
      var x = pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      var y = pad + innerH - ((v - min) / span) * innerH;
      return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    });
  }

  // Small inline sparkline (line + last-point dot). values: [num] | [{value}].
  function sparkline(values, opts) {
    opts = opts || {};
    var w = opts.width || 120, h = opts.height || 28, pad = 2;
    var nums = _nums(values);
    if (nums.length < 2) {
      return '<svg class="av-spark" viewBox="0 0 ' + w + ' ' + h + '" ' +
        'preserveAspectRatio="none" aria-hidden="true"></svg>';
    }
    var pts = _points(nums, w, h, pad);
    var line = pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
    var last = pts[pts.length - 1];
    return '<svg class="av-spark" viewBox="0 0 ' + w + ' ' + h + '" ' +
      'preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline class="av-spark__line" fill="none" stroke="currentColor" ' +
        'stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="' + line + '" />' +
      '<circle class="av-spark__dot" cx="' + last[0] + '" cy="' + last[1] + '" r="1.8" fill="currentColor" />' +
    '</svg>';
  }

  // Larger area chart with a soft fill (the trends panel). Same value shape.
  function areaChart(values, opts) {
    opts = opts || {};
    var w = opts.width || 640, h = opts.height || 160, pad = 6;
    var nums = _nums(values);
    if (nums.length < 2) {
      return '<svg class="av-area" viewBox="0 0 ' + w + ' ' + h + '" ' +
        'preserveAspectRatio="none" role="img"></svg>';
    }
    var pts = _points(nums, w, h, pad);
    var line = pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
    var areaD = 'M' + pts[0][0] + ',' + (h - pad) +
      ' L' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' L') +
      ' L' + pts[pts.length - 1][0] + ',' + (h - pad) + ' Z';
    return '<svg class="av-area" viewBox="0 0 ' + w + ' ' + h + '" ' +
      'preserveAspectRatio="none" role="img">' +
      '<path class="av-area__fill" d="' + areaD + '" fill="currentColor" fill-opacity="0.12" stroke="none" />' +
      '<polyline class="av-area__line" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' + line + '" />' +
    '</svg>';
  }

  // Period-over-period delta from a daily series: recent half vs prior half.
  // Returns { pct, dir: 'up'|'down'|'flat' } or null when not computable.
  function periodDelta(values) {
    var nums = _nums(values);
    if (nums.length < 4) return null;
    var mid = Math.floor(nums.length / 2);
    var prior = nums.slice(0, mid).reduce(function (a, b) { return a + b; }, 0);
    var recent = nums.slice(mid).reduce(function (a, b) { return a + b; }, 0);
    if (prior === 0) return recent > 0 ? { pct: null, dir: 'up' } : { pct: 0, dir: 'flat' };
    var pct = Math.round(((recent - prior) / prior) * 100);
    return { pct: pct, dir: pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat') };
  }

  window.avCharts = { sparkline: sparkline, areaChart: areaChart, periodDelta: periodDelta };
})();
