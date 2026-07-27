/*
 * admin-embed.js — one place that knows what "?embed=1" means.
 *
 * The Mock Test cockpit (/pages/admin/mock-tests/) hosts existing admin pages in
 * iframes. Each hosted page therefore renders its OWN title and intro, so the
 * cockpit showed the heading twice — once on its tab, once inside the frame.
 *
 * Pages built on <aver-admin-chrome> already had an answer (the component drops
 * its nav when given the `embed` attribute). The mock pages predate it and carry
 * plain headings, so they need this: a body class plus an explicit opt-in marker
 * on the elements the cockpit already provides.
 *
 * SHARED ON PURPOSE. Three copies of "read the query param, add the class" is
 * three places to drift, and the drift is invisible until someone opens a tab
 * and sees a duplicate title.
 *
 * Must load NON-deferred and before page scripts: the class has to be on <body>
 * before first paint, or the heading flashes in and then vanishes.
 *
 * Marking is opt-in via [data-embed-hide] rather than a blanket "hide every h1":
 * these pages use headings inside panels too, and hiding those would gut the
 * page instead of de-duplicating its chrome.
 */
(function () {
  'use strict';
  try {
    if (new URLSearchParams(window.location.search).get('embed') !== '1') return;
    var apply = function () {
      if (document.body) document.body.classList.add('is-embedded');
    };
    if (document.body) apply();
    else document.addEventListener('DOMContentLoaded', apply);
    // Also expose it for page scripts that need to branch (e.g. skip a redirect
    // that would navigate the whole cockpit instead of the frame).
    window.AVER_EMBEDDED = true;
  } catch (e) { /* never let chrome tidying break the page */ }
})();
