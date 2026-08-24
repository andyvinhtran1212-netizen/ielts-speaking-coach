/**
 * Recover the shared Next shells when their frozen primary Supabase CDN pin
 * fails.  The promise lets api.js queue initSupabase() without creating a
 * second GoTrue client; if Gate E has already fulfilled the primary script,
 * this resolves immediately and performs no network request.
 */
(function () {
  if (typeof window === 'undefined') return;

  function sdkReady() {
    return Boolean(
      window.supabase && typeof window.supabase.createClient === 'function'
    );
  }

  if (sdkReady()) {
    /** @type {any} */ (window).__AVER_SUPABASE_SDK_READY__ = Promise.resolve(true);
    return;
  }

  /** @type {any} */ (window).__AVER_SUPABASE_SDK_READY__ = new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.91.0/dist/umd/supabase.min.js';
    script.async = true;
    script.onload = function () {
      if (sdkReady()) resolve(true);
      else reject(new Error('Supabase fallback loaded without createClient.'));
    };
    script.onerror = function () {
      reject(new Error('Supabase primary and fallback browser bundles failed to load.'));
    };
    document.head.appendChild(script);
  });

  // Mark the promise handled before api.js attaches its diagnostic callback;
  // otherwise a very fast network failure becomes unrelated rejection noise.
  /** @type {any} */ (window).__AVER_SUPABASE_SDK_READY__.catch(function () {});
})();
