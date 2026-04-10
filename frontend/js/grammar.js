/**
 * grammar.js — Grammar Wiki shared logic
 *
 * Depends on api.js being loaded first (window.api.base, window.api.get).
 * All Grammar API endpoints are public — no auth required.
 */

(function () {
  'use strict';

  var _BASE = window.api.base;

  // ── Raw fetch helper (no auth needed) ─────────────────────────────────────
  async function fetchGrammarAPI(path) {
    var res = await fetch(_BASE + '/api/grammar' + path);
    if (!res.ok) {
      var err = {};
      try { err = await res.json(); } catch (_) {}
      throw new Error(err.detail || 'HTTP ' + res.status);
    }
    return res.json();
  }

  // ── Resolve page-relative app root ────────────────────────────────────────
  var _appRoot = /\/pages\/[^/]+$/.test(window.location.pathname) ? '../' : './';

  function _url(path) { return _appRoot + path; }

  // ── Level badge ───────────────────────────────────────────────────────────
  var _levelColors = {
    beginner:     'bg-emerald-500/15 text-emerald-400',
    intermediate: 'bg-yellow-500/15 text-yellow-400',
    advanced:     'bg-red-500/15 text-red-400',
  };

  function levelBadge(level) {
    if (!level) return '';
    var cls = _levelColors[level.toLowerCase()] || 'bg-white/10 text-white/60';
    return '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ' + cls + '">' +
           level.charAt(0).toUpperCase() + level.slice(1) + '</span>';
  }

  // ── Category card ─────────────────────────────────────────────────────────
  function renderCategoryCards(categories, containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!categories || categories.length === 0) {
      el.innerHTML = '<p class="text-white/40 text-sm">Chưa có chủ đề nào.</p>';
      return;
    }
    el.innerHTML = categories.map(function (cat) {
      return '<a href="' + _url('grammar.html') + '?category=' + cat.slug + '" ' +
             'class="cat-card group block p-5 rounded-2xl border border-white/8 ' +
             'bg-white/[0.03] hover:border-teal/40 hover:bg-teal/[0.07] transition-all duration-200">' +
             '<div class="flex items-center gap-3 mb-3">' +
             '<div class="w-9 h-9 rounded-xl bg-teal/15 flex items-center justify-center flex-shrink-0">' +
             '<svg class="w-5 h-5 text-teal-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
             '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>' +
             '</div>' +
             '<div><h3 class="font-semibold text-white group-hover:text-teal-light transition-colors">' + cat.title + '</h3>' +
             '<p class="text-xs text-white/40">' + cat.article_count + ' bài</p></div>' +
             '</div>' +
             (cat.articles && cat.articles.length
               ? '<ul class="space-y-1">' + cat.articles.slice(0, 3).map(function (a) {
                   return '<li class="text-sm text-white/55 hover:text-white/90 truncate">' +
                          '<a href="' + _url('pages/grammar-article.html') + '?category=' + a.category + '&slug=' + a.slug + '">' +
                          a.title + '</a></li>';
                 }).join('') + '</ul>'
               : '') +
             '</a>';
    }).join('');
  }

  // ── Featured article card ──────────────────────────────────────────────────
  function renderFeaturedCards(articles, containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!articles || articles.length === 0) {
      el.innerHTML = '<p class="text-white/40 text-sm">Chưa có bài nào.</p>';
      return;
    }
    el.innerHTML = articles.map(function (a) {
      return '<a href="' + _url('pages/grammar-article.html') + '?category=' + a.category + '&slug=' + a.slug + '" ' +
             'class="block p-4 rounded-xl border border-white/8 bg-white/[0.03] ' +
             'hover:border-teal/40 hover:bg-teal/[0.07] transition-all duration-200">' +
             '<div class="flex items-start justify-between gap-2 mb-1">' +
             '<h4 class="font-semibold text-white text-sm leading-snug">' + a.title + '</h4>' +
             levelBadge(a.level) +
             '</div>' +
             '<p class="text-xs text-white/50 line-clamp-2 mb-2">' + (a.summary || '') + '</p>' +
             '<div class="flex items-center gap-3 text-xs text-white/30">' +
             '<span>' + a.category + '</span>' +
             '<span>' + (a.reading_time || 1) + ' phút</span>' +
             '</div></a>';
    }).join('');
  }

  // ── TOC renderer ──────────────────────────────────────────────────────────
  function renderTOC(tocItems, containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!tocItems || tocItems.length === 0) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = '<nav>' +
      '<p class="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">Nội dung</p>' +
      '<ul class="space-y-1">' +
      tocItems.map(function (item) {
        var indent = item.depth ? 'pl-' + (item.depth * 3) : '';
        return '<li class="' + indent + '">' +
               '<a href="#' + item.id + '" class="toc-link block text-sm text-white/50 hover:text-teal-light ' +
               'py-0.5 transition-colors leading-snug">' + item.name + '</a></li>';
      }).join('') +
      '</ul></nav>';

    // Highlight active TOC item on scroll
    var links = el.querySelectorAll('.toc-link');
    if (!links.length) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          links.forEach(function (l) { l.classList.remove('text-teal-light', '!text-white/90'); });
          var active = el.querySelector('a[href="#' + entry.target.id + '"]');
          if (active) active.classList.add('text-teal-light');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    document.querySelectorAll('.article-body h2, .article-body h3').forEach(function (h) {
      observer.observe(h);
    });
  }

  // ── Breadcrumb ────────────────────────────────────────────────────────────
  function renderBreadcrumb(category, articleTitle, containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML =
      '<a href="' + _url('grammar.html') + '" class="hover:text-teal-light transition-colors">Grammar Wiki</a>' +
      '<span class="mx-2 text-white/20">›</span>' +
      '<a href="' + _url('grammar.html') + '?category=' + category + '" class="hover:text-teal-light transition-colors capitalize">' +
      category.replace(/-/g, ' ') + '</a>' +
      '<span class="mx-2 text-white/20">›</span>' +
      '<span class="text-white/80">' + articleTitle + '</span>';
  }

  // ── Related pages ─────────────────────────────────────────────────────────
  function renderRelatedPages(pages, containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!pages || pages.length === 0) {
      el.parentElement && (el.parentElement.style.display = 'none');
      return;
    }
    el.innerHTML = pages.map(function (p) {
      return '<a href="' + _url('pages/grammar-article.html') + '?category=' + p.category + '&slug=' + p.slug + '" ' +
             'class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 ' +
             'bg-white/[0.04] text-sm text-white/70 hover:border-teal/40 hover:text-teal-light transition-all">' +
             p.title + '</a>';
    }).join('');
  }

  // ── Prev/Next nav ─────────────────────────────────────────────────────────
  function renderPrevNext(prev, next, containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var html = '<div class="flex gap-3">';
    if (prev) {
      html += '<a href="' + _url('pages/grammar-article.html') + '?category=' + prev.category + '&slug=' + prev.slug + '" ' +
              'class="flex-1 p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:border-teal/40 ' +
              'hover:bg-teal/[0.07] transition-all group">' +
              '<p class="text-xs text-white/30 mb-1">← Bài trước</p>' +
              '<p class="text-sm font-medium text-white/80 group-hover:text-white">' + prev.title + '</p></a>';
    }
    if (next) {
      html += '<a href="' + _url('pages/grammar-article.html') + '?category=' + next.category + '&slug=' + next.slug + '" ' +
              'class="flex-1 p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:border-teal/40 ' +
              'hover:bg-teal/[0.07] transition-all group text-right">' +
              '<p class="text-xs text-white/30 mb-1">Bài tiếp →</p>' +
              '<p class="text-sm font-medium text-white/80 group-hover:text-white">' + next.title + '</p></a>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  // ── Search ────────────────────────────────────────────────────────────────
  function setupSearch(inputId, onSubmit) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var q = input.value.trim();
        if (q.length >= 2) onSubmit(q);
      }
    });
  }

  function redirectToSearch(q) {
    window.location.href = _url('grammar.html') + '?q=' + encodeURIComponent(q);
  }

  // ── Home page loader ───────────────────────────────────────────────────────
  async function loadGrammarHome() {
    var params = new URLSearchParams(window.location.search);
    var searchQuery = params.get('q');
    var categoryFilter = params.get('category');

    // Search results mode
    if (searchQuery) {
      _showSection('search-results');
      var searchEl = document.getElementById('search-results-title');
      if (searchEl) searchEl.textContent = 'Kết quả cho "' + searchQuery + '"';
      try {
        var results = await fetchGrammarAPI('/search?q=' + encodeURIComponent(searchQuery));
        renderFeaturedCards(results, 'search-results-list');
      } catch (err) {
        _showError('search-results-list', err.message);
      }
      return;
    }

    // Category filter mode
    if (categoryFilter) {
      _showSection('category-view');
      var catTitle = document.getElementById('category-view-title');
      if (catTitle) catTitle.textContent = categoryFilter.replace(/-/g, ' ');
      try {
        var catData = await fetchGrammarAPI('/category/' + categoryFilter);
        if (catData && catTitle) catTitle.textContent = catData.title || categoryFilter;
        renderFeaturedCards(catData ? catData.articles : [], 'category-view-list');
      } catch (err) {
        _showError('category-view-list', err.message);
      }
      return;
    }

    // Full home page
    _showSection('home-content');
    try {
      var data = await fetchGrammarAPI('/home');
      renderCategoryCards(data.categories || [], 'category-cards');
      renderFeaturedCards(data.featured_articles || [], 'featured-list');
      var totalEl = document.getElementById('total-articles');
      if (totalEl) totalEl.textContent = data.total_articles || 0;
      var totalCatEl = document.getElementById('total-categories');
      if (totalCatEl) totalCatEl.textContent = data.total_categories || 0;
    } catch (err) {
      _showError('category-cards', err.message);
    }
  }

  // ── Article page loader ───────────────────────────────────────────────────
  async function loadGrammarArticle() {
    var params = new URLSearchParams(window.location.search);
    var category = params.get('category');
    var slug = params.get('slug');

    if (!category || !slug) {
      _showError('article-container', 'Thiếu tham số category hoặc slug.');
      return;
    }

    try {
      var article = await fetchGrammarAPI('/article/' + category + '/' + slug);

      // Page title
      document.title = article.title + ' — Grammar Wiki';

      // Breadcrumb
      renderBreadcrumb(category, article.title, 'breadcrumb');

      // Header meta
      var titleEl = document.getElementById('article-title');
      if (titleEl) titleEl.textContent = article.title;

      var levelEl = document.getElementById('article-level');
      if (levelEl) levelEl.innerHTML = levelBadge(article.level);

      var metaEl = document.getElementById('article-meta');
      if (metaEl) {
        metaEl.innerHTML =
          '<span>' + (article.reading_time || 1) + ' phút đọc</span>' +
          (article.word_count ? '<span>· ' + article.word_count + ' từ</span>' : '') +
          (article.last_updated ? '<span>· Cập nhật: ' + article.last_updated + '</span>' : '');
      }

      // TOC
      renderTOC(article.toc || [], 'toc-container');

      // Article body
      var bodyEl = document.getElementById('article-body');
      if (bodyEl) {
        bodyEl.classList.add('article-body');
        bodyEl.innerHTML = article.html || '';
      }

      // Related pages
      renderRelatedPages(article.related_pages || [], 'related-pages');

      // Prev/Next
      renderPrevNext(article.prev_article, article.next_article, 'prev-next');

      // Show content, hide skeleton
      _show('article-container');
      _hide('article-skeleton');
    } catch (err) {
      _hide('article-skeleton');
      _showError('article-container', 'Không tải được bài: ' + err.message);
      _show('article-container');
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function _show(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }
  function _hide(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }
  function _showSection(id) {
    ['home-content', 'search-results', 'category-view'].forEach(_hide);
    _show(id);
  }
  function _showError(containerId, msg) {
    var el = document.getElementById(containerId);
    if (el) el.innerHTML = '<p class="text-red-400 text-sm py-4">Lỗi: ' + msg + '</p>';
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.grammarWiki = {
    fetchGrammarAPI:    fetchGrammarAPI,
    loadGrammarHome:    loadGrammarHome,
    loadGrammarArticle: loadGrammarArticle,
    renderCategoryCards: renderCategoryCards,
    renderFeaturedCards: renderFeaturedCards,
    renderRelatedPages:  renderRelatedPages,
    renderTOC:           renderTOC,
    renderBreadcrumb:    renderBreadcrumb,
    renderPrevNext:      renderPrevNext,
    setupSearch:         setupSearch,
    redirectToSearch:    redirectToSearch,
    levelBadge:          levelBadge,
  };
})();
