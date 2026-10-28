'use client';

import { useEffect, useState } from 'react';

import {
  getAdminTestDataVisibility,
  isStagingRuntime,
  normalizeTestDataVisibility,
  SHOW_TEST_DATA_STORAGE_KEY,
  type AdminTestDataVisibilityWire,
} from '@/lib/admin-test-data-api';

/**
 * TASK B2 — staging only. The backend hides E2E/QA test data from list views
 * when HIDE_TEST_DATA is on; this bar lets an admin opt in to see it. Renders
 * nothing (and asks nothing) off staging, or unless the backend reports hiding
 * as active. The state shown is the server's answer for this browser, and a
 * change reloads so every panel refetches canonical data with the new header.
 */
export function AdminTestDataToggle() {
  const [visibility, setVisibility] = useState<AdminTestDataVisibilityWire | null>(null);

  useEffect(() => {
    if (!isStagingRuntime()) return;
    let dead = false;
    getAdminTestDataVisibility()
      .then((payload) => { if (!dead) setVisibility(normalizeTestDataVisibility(payload)); })
      .catch(() => { if (!dead) setVisibility(null); });
    return () => { dead = true; };
  }, []);

  if (!visibility) return null;
  const showing = visibility.showing_test_data;

  function toggle() {
    try {
      if (showing) window.localStorage.removeItem(SHOW_TEST_DATA_STORAGE_KEY);
      else window.localStorage.setItem(SHOW_TEST_DATA_STORAGE_KEY, '1');
    } catch {
      return;
    }
    window.location.reload();
  }

  return (
    <div className="adm-test-data-bar" role="status" data-showing={showing ? 'true' : 'false'}>
      <span className="adm-test-data-bar__message">
        {showing
          ? 'Đang hiện dữ liệu kiểm thử của staging (tài khoản E2E, lớp và đề QA).'
          : 'Staging đang ẩn dữ liệu kiểm thử (tài khoản E2E, lớp và đề QA).'}
      </span>
      <button type="button" className="adm-test-data-bar__action" onClick={toggle}>
        {showing ? 'Ẩn dữ liệu kiểm thử' : 'Hiện dữ liệu kiểm thử'}
      </button>
    </div>
  );
}
