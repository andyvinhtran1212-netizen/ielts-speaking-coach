# Verification

## Requirement coverage

Cập nhật 23/11/2026 (G03-T17a, đối chiếu tạm) trên `staging` @cc6dd4c8. Lệnh đã chạy: `node --test` 6 file test hợp đồng (100/100), `vitest run tests/react/ui` cùng 4 file test React liên quan (146/146), và job CI "Next-native browser regression" trên chính SHA đó (run 45115869263, bước ảnh chụp và bước kiểm 404 đều success). Các dòng `PENDING` chờ nhiệm vụ chưa merge: T08 #2494, T09 #2499, T10 #2492, T16 #2465, và G11-T32 (bộ icon). Spec **chưa** chuyển `verified`; phần cuối (G03-T17b) làm khi các PR đó merge.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=frontend/tests/av2-tokens.test.mjs "groups of plan 5.2 (FR-001)", tests/undefined-token-sentinel.test.mjs; node --test @cc6dd4c8 (100/100) | PASS |
| FR-002 | kind=test; ref=frontend/tests/authed-shell.test.mjs "design=\"v2\" bỏ toàn bộ CSS/script cũ" (node --test @cc6dd4c8 (100/100)); tests/visual/ui-library.spec.mjs, public-pages.spec.mjs, v2-boundary.spec.mjs "scenario 1" (CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success)) | PASS |
| FR-003 | kind=test; ref=frontend/tests/authed-shell.test.mjs (trang cũ giữ mọi thẻ link và script cũ, cùng thứ tự, từ G03-T12 #2432), node --test @cc6dd4c8 (100/100) | PASS |
| FR-004 | kind=screenshot; ref=frontend/tests/visual/ui-library.spec.mjs "the page runs on the v2 tree only (FR-002, FR-004)", ảnh mốc tokens-vietnamese(-dark).png, tokens-type(-dark).png ở 1280/390; CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success) | PASS |
| FR-005 | kind=test; ref=frontend/tests/react/ui/{buttons,choice-status,feedback,fields,navigation,overlays}.test.tsx cho đợt G03-T05/T06/T07 đã merge (vitest @cc6dd4c8 (146/146)). Còn đợt T08 #2494, T09 #2499, T10 #2492 chưa merge | PENDING |
| FR-006 | kind=check; ref=bộ 94 icon do G11-T32 dựng (thay G03-T03); `components/ui/icon/icon-set.ts` trên staging chưa phải bộ 94 icon và chưa có test quét emoji/lucide trong components/ui. Chờ G11-T32 | PENDING |
| FR-007 | kind=test; ref=frontend/tests/react/ui/learner-shell.test.tsx "five fixed sections", "tablet menu names the current section", "derives the current section … route registry" (vitest @cc6dd4c8 (146/146)); tests/visual/learner-shell.spec.mjs "scenario 3" (CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success)) | PASS |
| FR-008 | kind=test; ref=frontend/tests/react/ui/learner-shell.test.tsx "learner: fixed order, no Đổi vai trò", "admin confirmed by the server" (vitest @cc6dd4c8 (146/146)); tests/visual/learner-shell.spec.mjs "scenario 4" (CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success)) | PASS |
| FR-009 | kind=test; ref=frontend/tests/react/ui/focus-shell.test.tsx (hỏi lại chỉ khi mất bài, bản thi không có chữ tiếng Việt, không chân trang/lượt AI/nút tài khoản) (vitest @cc6dd4c8 (146/146)); tests/visual/focus-shell.spec.mjs (CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success)) | PASS |
| FR-010 | kind=test; ref=StaffShell + EnvBadge thuộc G03-T16, PR #2465 chưa merge | PENDING |
| FR-011 | kind=test; ref=frontend/tests/react/ui/public-shell.test.tsx và tests/react/legal-pages.test.tsx (vitest @cc6dd4c8 (146/146)), tests/visual/public-pages.spec.mjs bốn trang và "phone menu open" (CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước ảnh chụp success) | PASS |
| FR-012 | kind=test; ref=frontend/tests/route-registry.test.mjs "route registry (FR-012)"; node --test @cc6dd4c8 (100/100) | PASS |
| FR-013 | kind=check; ref=.github/workflows/next-native-browser.yml bước "Kiểm /ui-library là 404 khi build không bật cờ" success ở CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8); tests/av2-tokens.test.mjs "/ui-library Màu shows a swatch for every colour token" | PASS |
| FR-014 | kind=check; ref=.github/workflows/next-native-browser.yml bước ảnh chụp trong job sẵn có, tests/visual/*.spec.mjs với ảnh mốc tests/visual/__screenshots__/{desktop-1280,phone-390}; CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success) | PASS |
| FR-015 | kind=journey; ref=frontend/tests/visual/v2-boundary.spec.mjs "v1 → v2 is a full load" (scenario 1), "v2 → v1 is a full load" (scenario 2) (CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success)); tests/v2-routes.test.mjs (node --test @cc6dd4c8 (100/100)); tests/react/admin-chrome-navigation.test.tsx (vitest @cc6dd4c8 (146/146)) | PASS |
| FR-016 | kind=test; ref=frontend/tests/react/ui/learner-shell.test.tsx "credits: … trial text without a course" (vitest @cc6dd4c8 (146/146)). Kiểm thêm: các file frontend/components/ui/shell/learner-*.tsx không gắn cổng kích hoạt và không gọi API (grep activation, fetch(, window.api @cc6dd4c8: chỉ có chú thích ở dòng 50 của learner-shell.tsx) | PASS |
| FR-017 | kind=test; ref=frontend/tests/react/ui/learner-shell.test.tsx "/ opens it with focus in the field", "groups in sheet order, 2 rows each", "a failed search says so" (vitest @cc6dd4c8 (146/146)); tests/visual/learner-shell.spec.mjs "quick lookup" (CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success)) | PASS |
| FR-018 | kind=screenshot; ref=StaffShell 1024px cột icon thuộc G03-T16, PR #2465 chưa merge | PENDING |
| FR-019 | kind=test; ref=frontend/tests/av2-tokens.test.mjs "light, dark and OS-dark (FR-019, FR-024)"; node --test @cc6dd4c8 (100/100) | PASS |
| FR-020 | kind=test; ref=frontend/tests/visual/ui-library.spec.mjs "no light flash: stored dark on a light device, and no choice on a dark device"; CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success) | PASS |
| FR-021 | kind=test; ref=frontend/tests/react/ui/theme.test.tsx (ba lựa chọn, "Theo thiết bị" xoá khoá, theo tab khác qua storage, bỏ qua thay đổi thiết bị khi đã chọn) (vitest @cc6dd4c8 (146/146)); tests/visual/ui-library.spec.mjs "ThemeMenu: choose Tối, the other tab follows" (CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success)) | PASS |
| FR-022 | kind=test; ref=frontend/tests/av2-tokens.test.mjs "WCAG contrast (FR-022)"; node --test @cc6dd4c8 (100/100) | PASS |
| FR-023 | kind=test; ref=frontend/tests/av2-tokens.test.mjs "no faked colours (FR-023)"; node --test @cc6dd4c8 (100/100) | PASS |
| FR-024 | kind=test; ref=frontend/tests/av2-tokens.test.mjs "always-light wrapper re-declares the light colours", "print is light even when the site or the OS is dark" (node --test @cc6dd4c8 (100/100)); tests/visual/ui-library.spec.mjs "print media stays light while dark is chosen" (CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success)). Lớp `.av2-always-light` là cách làm của FR; trang thư, QR, ảnh Task 1 gắn lớp khi dựng | PASS |
| FR-025 | kind=test; ref=frontend/tests/react/ui/focus-shell.test.tsx "the full-test room stays light (FR-025)" (vitest @cc6dd4c8 (146/146)); tests/visual/focus-shell.spec.mjs "FR-025: with the site dark" (CI run 45115869263 (Next-native browser regression, push staging @cc6dd4c8, bước "Kiểm ảnh chụp thư viện component" success)) | PASS |
| FR-026 | kind=test; ref=frontend/tests/av2-theme-color.test.mjs (node --test @cc6dd4c8 (100/100)); tests/react/ui/theme.test.tsx "re-points both theme-color metas" (vitest @cc6dd4c8 (146/146)) | PASS |

## UI evidence

- Viewports/themes/input methods: 1280px và 390px (thêm 1024px cho khung admin), sáng và tối (T018), bàn phím và trình đọc màn hình; ảnh `/ui-library` đặt cạnh tờ thiết kế.

## Release evidence

- Staging: `/terms`, `/privacy`, `/contact`, `/about` dùng khung mới; `/home`, `/admin` không đổi; `/ui-library` 404.
