/* Shared section renderers for Writing Coach feedback (Sprint 2.5.5).
 *
 * Extracted from frontend/pages/admin-writing-grade.html so the
 * student result page (writing-result.html) consumes the same renderers.
 * Each renderer is a pure function: takes the raw value from
 * feedback_json[key], returns an HTML string.  No JSON.stringify
 * fallback ever — unrecognised shapes surface as an explicit empty
 * state so a bug shows visually instead of leaking raw payloads.
 *
 * Usage:
 *   const renderer = WritingRenderers.SECTION_RENDERERS[sectionKey];
 *   contentEl.innerHTML = renderer(feedback_json[dataKey]);
 *
 * Depends on window.WC.escapeHtml (defined in frontend/js/api.js).
 */

(function (global) {
  'use strict';

  function escapeHtml(s) {
    if (global.WC && typeof global.WC.escapeHtml === 'function') {
      return global.WC.escapeHtml(s);
    }
    // Fallback escape — minimal, mirrors WC.escapeHtml semantics.
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isEmpty(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v))      return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  }

  function renderString(v) {
    var safe = escapeHtml(v);
    var paras = safe.split(/\n{2,}/).filter(function (p) { return p.trim(); });
    return paras.map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  function bandClass(band) {
    var n = parseFloat(band);
    if (isNaN(n)) return 'mid';
    if (n < 5)    return 'low';
    if (n < 6)    return 'mid';
    if (n < 7)    return 'good';
    return 'high';
  }

  function trendArrow(trend) {
    return ({ improving: '↑', stable: '→', declining: '↓' })[trend] || '·';
  }
  function trendLabel(trend) {
    return ({
      improving: 'Cải thiện',
      stable:    'Ổn định',
      declining: 'Giảm',
    })[trend] || (trend || '—');
  }
  function criterionAbbr(criterion) {
    return ({
      'Task Response':                  'TR',
      'Task Achievement':               'TA',
      'Coherence and Cohesion':         'C&C',
      'Lexical Resource':               'LR',
      'Grammatical Range and Accuracy': 'G&A',
    })[criterion] || criterion;
  }
  function complexityLabel(c) {
    return ({
      needs_more_simple:  'Cần thêm câu đơn',
      balanced:           'Cân bằng tốt',
      needs_more_complex: 'Cần thêm câu phức',
    })[c] || c;
  }

  function proseBlock(text) {
    return '<div class="prose-block">' + renderString(text) + '</div>';
  }

  function emptyShape(msg) {
    return '<p class="empty-state">' + escapeHtml(msg || '— Chưa có nội dung —') + '</p>';
  }

  // ── Section 1 — Overview (string) ──────────────────────────────────
  function renderOverview(v) {
    if (isEmpty(v) || typeof v !== 'string') return emptyShape();
    return proseBlock(v);
  }

  // ── Section 2 — 4 IELTS criteria ──────────────────────────────────
  // Schema: {mainCriterion, coherenceCohesion, lexicalResource,
  //          grammaticalRange} each {title, explanation, feedback,
  //          bandScore}. Some prompts also produce a flat array
  //          [{criterion, band, summary, detailedFeedback}, ...].
  function renderCriteriaFeedback(v) {
    if (isEmpty(v)) return emptyShape();

    var items = [];
    if (Array.isArray(v)) {
      items = v.map(function (it) {
        return {
          label:   it.criterion || it.title || '—',
          band:    it.band != null ? it.band : it.bandScore,
          summary: it.summary || it.explanation || '',
          body:    it.detailedFeedback || it.feedback || '',
        };
      });
    } else if (typeof v === 'object') {
      var ORDER = [
        { key: 'mainCriterion',     label: 'Task Response / Achievement' },
        { key: 'coherenceCohesion', label: 'Coherence & Cohesion' },
        { key: 'lexicalResource',   label: 'Lexical Resource' },
        { key: 'grammaticalRange',  label: 'Grammatical Range' },
      ];
      items = ORDER.map(function (slot) {
        var it = v[slot.key] || {};
        return {
          label:   it.title || slot.label,
          band:    it.bandScore,
          summary: it.explanation || '',
          body:    it.feedback || '',
        };
      });
    }
    if (!items.length) return emptyShape();

    return '<div class="criteria-grid">' + items.map(function (it) {
      var band = it.band != null ? it.band : '—';
      return (
        '<div class="card-criterion">' +
          '<div class="card-criterion-head">' +
            '<h3>' + escapeHtml(it.label) + '</h3>' +
            '<span class="band-pill band-' + bandClass(it.band) + '">' + escapeHtml(String(band)) + '</span>' +
          '</div>' +
          (it.summary ? '<div class="summary">'  + escapeHtml(it.summary) + '</div>' : '') +
          (it.body    ? '<div class="feedback">' + escapeHtml(it.body)    + '</div>' : '') +
        '</div>'
      );
    }).join('') + '</div>';
  }

  // ── Section 3 — Mistake analysis ──────────────────────────────────
  function renderMistakeAnalysis(v) {
    if (isEmpty(v)) {
      return '<p class="empty-state">— Không có lỗi nào trong bài —</p>';
    }
    if (!Array.isArray(v)) return emptyShape('— Định dạng dữ liệu không hợp lệ —');
    return v.map(function (m) {
      var sev = (m.severity || 'medium').toLowerCase();
      if (sev !== 'high' && sev !== 'low' && sev !== 'medium') sev = 'medium';
      return (
        '<div class="mistake-card mistake-' + sev + '">' +
          '<div class="mistake-header">' +
            '<span class="mistake-type-badge">' + escapeHtml(m.type || m.mistakeType || 'Other') + '</span>' +
            (m.criterion ? '<span class="mistake-criterion">' + escapeHtml(m.criterion) + '</span>' : '') +
          '</div>' +
          (m.original   ? '<div class="mistake-diff">' +
            '<div class="mistake-original"><span class="diff-label">Gốc</span><code>' + escapeHtml(m.original) + '</code></div>' +
            (m.suggestion ? '<div class="mistake-suggestion"><span class="diff-label">Sửa</span><code>' + escapeHtml(m.suggestion) + '</code></div>' : '') +
          '</div>' : '') +
          (m.explanation ? '<p class="mistake-explanation">' + escapeHtml(m.explanation) + '</p>' : '') +
        '</div>'
      );
    }).join('');
  }

  // ── Section 4 — Recurring patterns ────────────────────────────────
  function renderRecurringPatterns(v) {
    if (isEmpty(v) || typeof v !== 'object' || Array.isArray(v)) return emptyShape();
    var html = '';

    if (v.summary && String(v.summary).trim()) {
      html += '<div class="callout-info">' + renderString(String(v.summary)) + '</div>';
    }

    var improvements = Array.isArray(v.improvements) ? v.improvements.filter(Boolean) : [];
    if (improvements.length) {
      html += '<div style="margin-top:0.875rem;">' +
        '<h4 class="subsection-heading">✓ Đã cải thiện</h4>' +
        '<div class="chip-list chip-success">' +
          improvements.map(function (i) { return '<span class="chip">' + escapeHtml(String(i)) + '</span>'; }).join('') +
        '</div>' +
      '</div>';
    }

    var still = v.stillRecurring;
    var stillArr = Array.isArray(still)
      ? still.filter(Boolean)
      : (still && String(still).trim() ? [still] : []);
    if (stillArr.length) {
      html += '<div style="margin-top:0.875rem;">' +
        '<h4 class="subsection-heading">⚠ Vẫn lặp lại</h4>' +
        '<div class="chip-list chip-warning">' +
          stillArr.map(function (i) { return '<span class="chip">' + escapeHtml(String(i)) + '</span>'; }).join('') +
        '</div>' +
      '</div>';
    } else if (improvements.length) {
      html += '<p class="empty-state" style="margin-top:0.625rem;">— Không có lỗi nào còn lặp lại —</p>';
    }

    return html || emptyShape();
  }

  // ── Section 5 — Band trajectory ───────────────────────────────────
  function renderBandTrajectory(v) {
    if (isEmpty(v) || typeof v !== 'object' || Array.isArray(v)) return emptyShape();
    var html = '';
    var trend = v.trend || '—';
    html += '<div class="stat-grid">' +
      '<div class="stat-tile"><div class="stat-label">Bài hiện tại</div><div class="stat-value">' + escapeHtml(String(v.current_band != null ? v.current_band : '—')) + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">TB 5 bài gần nhất</div><div class="stat-value">' + escapeHtml(String(v.average_last_5 != null ? v.average_last_5 : '—')) + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Xu hướng</div><div class="stat-value trend-' + escapeHtml(trend) + '">' + trendArrow(trend) + ' ' + escapeHtml(trendLabel(trend)) + '</div></div>' +
    '</div>';

    if (v.trend_explanation) {
      html += '<div class="prose-block" style="margin-top:0.875rem;">' + renderString(String(v.trend_explanation)) + '</div>';
    }
    if (v.next_target) {
      html += '<div class="callout-action" style="margin-top:0.875rem;">' +
        '<span class="callout-label">🎯 Mục tiêu tiếp theo</span>' +
        renderString(String(v.next_target)) +
      '</div>';
    }

    if (Array.isArray(v.criteria_breakdown) && v.criteria_breakdown.length) {
      html += '<div style="margin-top:0.875rem;">' +
        '<h4 class="subsection-heading">Chi tiết từng tiêu chí</h4>' +
        '<div class="criterion-mini-grid">' +
          v.criteria_breakdown.map(function (c) {
            var t = c.trend || 'stable';
            return (
              '<div class="criterion-mini">' +
                '<div class="criterion-mini-label">' + escapeHtml(criterionAbbr(c.criterion || '—')) + '</div>' +
                '<div class="criterion-mini-value trend-' + escapeHtml(t) + '">' +
                  escapeHtml(String(c.average != null ? c.average : '—')) + ' ' + trendArrow(t) +
                '</div>' +
              '</div>'
            );
          }).join('') +
        '</div>' +
      '</div>';
    }

    return html;
  }

  // ── Section 6 — Sentence structure (Phase 1.5c canonical OR legacy)
  function renderSentenceStructure(v) {
    if (isEmpty(v) || typeof v !== 'object' || Array.isArray(v)) return emptyShape();

    if (Array.isArray(v.sentenceUpgrades)) {
      if (!v.sentenceUpgrades.length) return emptyShape();
      return v.sentenceUpgrades.map(function (s) {
        return (
          '<div class="lexical-card">' +
            '<div class="lexical-row">' +
              '<span class="lexical-original">' + escapeHtml(s.original   || '') + '</span>' +
              '<span class="lexical-arrow">→</span>' +
              '<span class="lexical-upgrade">'  + escapeHtml(s.rewritten  || s.upgraded || '') + '</span>' +
            '</div>' +
            (s.explanation ? '<div class="lexical-explain">' + escapeHtml(s.explanation) + '</div>' : '') +
          '</div>'
        );
      }).join('');
    }

    var html = '';
    if (v.summary) {
      html += '<div class="prose-block">' + renderString(String(v.summary)) + '</div>';
    }

    if (v.focus_theme && typeof v.focus_theme === 'object') {
      var ft = v.focus_theme;
      html += '<div class="focus-theme-card" style="margin-top:0.875rem;">' +
        '<div class="focus-theme-eyebrow">⭐ Tâm điểm tuần này</div>' +
        (ft.title ? '<h3 class="focus-theme-title">' + escapeHtml(ft.title) + '</h3>' : '') +
        (ft.why   ? '<p class="focus-theme-why">'    + escapeHtml(ft.why)   + '</p>' : '') +
        (ft.this_week_practice ?
          '<div class="focus-theme-action">' +
            '<span class="action-label">📝 Bài tập tuần này</span>' +
            '<p>' + escapeHtml(ft.this_week_practice) + '</p>' +
          '</div>' : '') +
      '</div>';
    }

    if (v.current_essay_observation) {
      html += '<div class="callout-info" style="margin-top:0.875rem;">' +
        '<span class="callout-label">📍 Quan sát bài này</span>' +
        renderString(String(v.current_essay_observation)) +
      '</div>';
    }

    if (Array.isArray(v.common_issues) && v.common_issues.length) {
      html += '<div style="margin-top:0.875rem;">' +
        '<h4 class="subsection-heading">Lỗi phổ biến</h4>' +
        '<div style="display:flex;flex-direction:column;gap:0.5rem;">' +
          v.common_issues.map(function (i) {
            var examples = Array.isArray(i.examples) ? i.examples : [];
            return (
              '<div class="issue-card">' +
                '<div class="issue-card-head">' +
                  '<span class="issue-pattern">' + escapeHtml(i.pattern || '—') + '</span>' +
                  (i.count != null ? '<span class="issue-count">' + escapeHtml(String(i.count)) + '×</span>' : '') +
                '</div>' +
                (examples.length ?
                  '<ul class="issue-examples">' +
                    examples.map(function (ex) { return '<li><code>' + escapeHtml(String(ex)) + '</code></li>'; }).join('') +
                  '</ul>' : '') +
              '</div>'
            );
          }).join('') +
        '</div>' +
      '</div>';
    }

    if (v.complexity_indicator) {
      html += '<div class="complexity-meter" style="margin-top:0.875rem;">' +
        '<span class="complexity-label">Độ phức tạp:</span>' +
        '<span class="complexity-value complexity-' + escapeHtml(v.complexity_indicator) + '">' +
          escapeHtml(complexityLabel(v.complexity_indicator)) +
        '</span>' +
      '</div>';
    }

    return html || emptyShape();
  }

  // ── Section 7 — Coherence ─────────────────────────────────────────
  function renderCoherenceAnalysis(v) {
    if (isEmpty(v)) return emptyShape();
    if (!Array.isArray(v)) return emptyShape('— Định dạng dữ liệu không hợp lệ —');
    return v.map(function (it) {
      var sug = it.suggestion;
      var sugHtml = '';
      if (sug && typeof sug === 'object') {
        var parts = [];
        if (sug.instruction) parts.push(escapeHtml(sug.instruction));
        if (sug.example)     parts.push('<code>' + escapeHtml(sug.example) + '</code>');
        sugHtml = parts.join(' — ');
      } else if (typeof sug === 'string') {
        sugHtml = escapeHtml(sug);
      }
      return (
        '<div class="coherence-card">' +
          '<div class="coherence-card-head">' +
            (it.location ? '<span class="coherence-location">' + escapeHtml(it.location) + '</span>' : '') +
            '<span class="coherence-issue">' + escapeHtml(it.issue || '—') + '</span>' +
          '</div>' +
          (it.explanation ? '<div class="coherence-explain">' + escapeHtml(it.explanation) + '</div>' : '') +
          (sugHtml ? '<div class="coherence-suggest">→ ' + sugHtml + '</div>' : '') +
        '</div>'
      );
    }).join('');
  }

  // ── Section 8 — Lexical (5 input shapes) ──────────────────────────
  function renderLexicalAnalysis(v) {
    if (isEmpty(v)) return emptyShape();

    if (typeof v === 'string') {
      return '<p class="prose-block">' + escapeHtml(v) + '</p>';
    }

    var words = null;
    if (Array.isArray(v))                       words = v;
    else if (Array.isArray(v.wordsToUpgrade))   words = v.wordsToUpgrade;
    else if (Array.isArray(v.upgrades))         words = v.upgrades;
    else if (Array.isArray(v.suggestions))      words = v.suggestions;

    if (Array.isArray(words)) {
      if (!words.length) return emptyShape();
      return words.map(function (w) {
        if (typeof w === 'string') {
          return '<div class="lexical-card"><div class="lexical-row">' +
            '<span class="lexical-original">' + escapeHtml(w) + '</span>' +
          '</div></div>';
        }
        var orig    = w.originalWord    || w.original  || w.word       || w.from || '';
        var upgrade = w.suggestedUpgrade || w.upgrade  || w.suggestion || w.upgraded || w.to || w.improved || '';
        if (!upgrade && Array.isArray(w.suggestions) && w.suggestions.length) {
          upgrade = w.suggestions.join(', ');
        }
        var explain = w.explanation     || w.reason   || w.context    || '';
        return (
          '<div class="lexical-card">' +
            '<div class="lexical-row">' +
              '<span class="lexical-original">' + escapeHtml(orig) + '</span>' +
              '<span class="lexical-arrow">→</span>' +
              '<span class="lexical-upgrade">'  + escapeHtml(upgrade) + '</span>' +
            '</div>' +
            (explain ? '<div class="lexical-explain">' + escapeHtml(explain) + '</div>' : '') +
          '</div>'
        );
      }).join('');
    }

    if (typeof v === 'object') {
      var entries = Object.keys(v).filter(function (k) {
        return ['summary','strengths','wordsToUpgrade','upgrades','suggestions'].indexOf(k) === -1;
      }).map(function (k) { return [k, v[k]]; });

      var wrapper = '';
      if (v.summary) {
        wrapper += '<p class="prose-block" style="margin-bottom:0.625rem;">' +
          escapeHtml(String(v.summary)) + '</p>';
      }
      if (Array.isArray(v.strengths) && v.strengths.length) {
        wrapper += '<div class="chip-list chip-success" style="margin-bottom:0.75rem;">' +
          v.strengths.map(function (s) {
            return '<span class="chip">' + escapeHtml(String(s)) + '</span>';
          }).join('') + '</div>';
      }

      if (!entries.length) {
        return wrapper || emptyShape();
      }

      var rows = entries.map(function (kv) {
        var word = kv[0];
        var sugg = kv[1];
        if (sugg && typeof sugg === 'object') {
          return renderLexicalAnalysis(sugg);
        }
        return (
          '<div class="lexical-row">' +
            '<span class="lexical-original">' + escapeHtml(String(word)) + '</span>' +
            '<span class="lexical-arrow">→</span>' +
            '<span class="lexical-upgrade">'  + escapeHtml(String(sugg == null ? '' : sugg)) + '</span>' +
          '</div>'
        );
      }).join('');

      return wrapper + '<div class="lexical-list">' + rows + '</div>';
    }

    return emptyShape('— Định dạng không nhận diện —');
  }

  // ── Section 9 — Idea development ─────────────────────────────────
  function renderIdeaDevelopment(v) {
    if (isEmpty(v)) return emptyShape();
    if (!Array.isArray(v)) return emptyShape('— Định dạng dữ liệu không hợp lệ —');
    return v.map(function (it) {
      var sug = it.suggestion;
      var sugHtml = '';
      if (sug && typeof sug === 'object') {
        var parts = [];
        if (sug.instruction) parts.push(escapeHtml(sug.instruction));
        if (sug.example)     parts.push('<code>' + escapeHtml(sug.example) + '</code>');
        sugHtml = parts.join(' — ');
      } else if (typeof sug === 'string') {
        sugHtml = escapeHtml(sug);
      }
      return (
        '<div class="idea-card">' +
          '<div class="idea-card-head">' +
            (it.paragraph != null ? '<span class="idea-paragraph-tag">¶ ' + escapeHtml(String(it.paragraph)) + '</span>' : '') +
            '<span class="idea-issue">' + escapeHtml(it.issue || '—') + '</span>' +
          '</div>' +
          (it.originalIdea ? '<div class="idea-row"><strong>Ý gốc:</strong> ' + escapeHtml(it.originalIdea) + '</div>' : '') +
          (it.explanation  ? '<div class="idea-row"><strong>Giải thích:</strong> ' + escapeHtml(it.explanation) + '</div>' : '') +
          (sugHtml         ? '<div class="idea-row"><strong>Gợi ý:</strong> ' + sugHtml + '</div>' : '') +
        '</div>'
      );
    }).join('');
  }

  // ── Section 10 — Counterargument ──────────────────────────────────
  function renderCounterargument(v) {
    if (isEmpty(v) || typeof v !== 'object' || Array.isArray(v)) return emptyShape();
    var present = !!v.isPresent;
    var pillCls = present ? 'present' : 'absent';
    var pillLbl = present ? '✓ Có counterargument' : '⚠ Không có counterargument';
    var html = '<div class="counter-block">' +
      '<div class="counter-status">' +
        '<span class="counter-pill ' + pillCls + '">' + pillLbl + '</span>' +
      '</div>';
    if (v.context)    html += '<div class="prose-block" style="margin-bottom:0.5rem;">' + renderString(String(v.context)) + '</div>';
    if (v.feedback)   html += '<div class="prose-block">' + renderString(String(v.feedback)) + '</div>';
    if (v.suggestion) html += '<div class="callout-action" style="margin-top:0.625rem;"><span class="callout-label">💡 Gợi ý</span>' + renderString(typeof v.suggestion === 'string' ? v.suggestion : (v.suggestion.instruction || '')) + '</div>';
    html += '</div>';
    return html;
  }

  // ── Section 11 — Improved essay ───────────────────────────────────
  function renderImprovedEssay(v) {
    if (isEmpty(v) || typeof v !== 'string') return emptyShape();
    return '<div class="essay-improved-block">' + escapeHtml(v) + '</div>';
  }

  // ── Section 12 — AI Content ───────────────────────────────────────
  function renderAIContent(v) {
    if (isEmpty(v) || typeof v !== 'object' || Array.isArray(v)) return emptyShape();
    var lik = parseFloat(v.likelihood);
    if (isNaN(lik)) lik = 0;
    if (lik > 0 && lik <= 1) lik = lik * 100;
    lik = Math.max(0, Math.min(100, lik));
    var fillCls = lik >= 70 ? 'likelihood-high' : (lik >= 30 ? 'likelihood-mid' : 'likelihood-low');

    var html = '<div class="likelihood-row">' +
      '<span class="likelihood-label">Xác suất AI viết</span>' +
      '<div class="likelihood-track"><div class="likelihood-fill ' + fillCls + '" style="width:' + lik.toFixed(0) + '%;"></div></div>' +
      '<span class="likelihood-pct">' + lik.toFixed(0) + '%</span>' +
    '</div>';
    if (v.explanation) {
      html += '<div class="prose-block" style="margin-top:0.5rem;">' + renderString(String(v.explanation)) + '</div>';
    }
    return html;
  }

  // ── Section 13 — Key takeaways ────────────────────────────────────
  function renderKeyTakeaways(v) {
    if (isEmpty(v) || typeof v !== 'object' || Array.isArray(v)) return emptyShape();

    function _list(items) {
      if (!items || (Array.isArray(items) && items.length === 0)) {
        return '<p class="empty-state">— —</p>';
      }
      if (typeof items === 'string') {
        return '<p style="font-size:13px;color:#cbd5e1;">' + escapeHtml(items) + '</p>';
      }
      return '<ul class="takeaway-list">' +
        items.map(function (i) { return '<li>' + escapeHtml(String(i)) + '</li>'; }).join('') +
      '</ul>';
    }

    return '<div class="takeaway-grid">' +
      '<div class="takeaway-block takeaway-success">' +
        '<h4 class="takeaway-heading">✓ Điểm mạnh</h4>' +
        _list(v.strengths) +
      '</div>' +
      '<div class="takeaway-block takeaway-warning">' +
        '<h4 class="takeaway-heading">↻ Cần cải thiện</h4>' +
        _list(v.areasForImprovement) +
      '</div>' +
    '</div>';
  }

  // ── Section 14 — Instructor note (string) ─────────────────────────
  function renderInstructorNoteValue(note) {
    if (!note || !String(note).trim()) {
      return '<p class="empty-state">— Giảng viên chưa để lại note —</p>';
    }
    return '<div class="instructor-note-block">' + renderString(String(note)) + '</div>';
  }

  // ── Dispatch table + JSON-key map ────────────────────────────────
  var SECTION_RENDERERS = {
    'overview':           renderOverview,
    'criteria':           renderCriteriaFeedback,
    'mistakes':           renderMistakeAnalysis,
    'recurring':          renderRecurringPatterns,
    'trajectory':         renderBandTrajectory,
    'sentence-structure': renderSentenceStructure,
    'coherence':          renderCoherenceAnalysis,
    'lexical':            renderLexicalAnalysis,
    'idea-development':   renderIdeaDevelopment,
    'counterargument':    renderCounterargument,
    'improved':           renderImprovedEssay,
    'ai-content':         renderAIContent,
    'key-takeaways':      renderKeyTakeaways,
  };

  var SECTION_KEYS = {
    'overview':           'overallBandScoreSummary',
    'criteria':           'criteriaFeedback',
    'mistakes':           'mistakeAnalysis',
    'recurring':          'recurringPatterns',
    'trajectory':         'bandTrajectoryAnalysis',
    'sentence-structure': 'sentenceStructureAnalysis',
    'coherence':          'coherenceAnalysis',
    'lexical':            'lexicalAnalysis',
    'idea-development':   'ideaDevelopmentAnalysis',
    'counterargument':    'counterargumentAnalysis',
    'improved':           'improvedEssay',
    'ai-content':         'aiContentAnalysis',
    'key-takeaways':      'keyTakeaways',
  };

  // Public surface — only what the page needs.
  global.WritingRenderers = {
    SECTION_RENDERERS:        SECTION_RENDERERS,
    SECTION_KEYS:             SECTION_KEYS,
    renderInstructorNote:     renderInstructorNoteValue,
    isEmpty:                  isEmpty,
    emptyShape:               emptyShape,
  };
})(window);
