# Post-flip full-stack audit — 2026-09-09

## Kết luận và giới hạn

**Cập nhật sau audit:** owner đã yêu cầu sửa code. Kết quả remediation local và các bước còn cần phê duyệt được ghi riêng tại [POST_FLIP_REMEDIATION_2026-09-09.md](POST_FLIP_REMEDIATION_2026-09-09.md). Những số liệu và mô tả bên dưới là baseline trước sửa, không phải trạng thái bản vá hay cam kết đã deploy.

Trạng thái: **baseline audit hoàn thành; chương trình audit sâu vẫn OPEN**. Có 9 hạng mục cần xử lý/giảm rủi ro, không phải 9 sự cố mới do flip. Chưa xác nhận exploit Critical hay mất bài do release này. CI xanh không đồng nghĩa đã đóng mọi rủi ro.

Release đối chiếu: `453e748998fe4c1b8d0ca6ece71afcab6a937d9c`, PR #1348. Main/staging cùng release; các job CI sau merge thành công. Không sửa code sản phẩm, không thay runtime flags, không ghi database, không dismiss log, không deploy trong đợt này. Báo cáo ở nhánh riêng `codex/post-flip-full-stack-audit-2026-09-09`; không đụng checkout đang có công việc khác.

Hard flip là quyết định bỏ release hold của soak, **không phải Gate E/F đã pass**. Không khởi động lại, xóa lịch hoặc thay đổi evidence trong đợt audit này. Legacy artifacts vẫn được giữ.

## Coverage thực tế

| Lớp | Đã kiểm tra | Không được suy rộng thành |
|---|---|---|
| Release/routing | SHA, CI sau merge; kế thừa phép kiểm tra ngay sau flip: 129 nguồn HTML/139 rule redirect đúng 308 và query | Không rerun toàn bộ redirect matrix lần nữa trong audit này |
| Frontend inventory | 132 file page.tsx; đọc luồng quan trọng, API adapter và cơ chế lưu/submit | Không phải đọc hết từng dòng của 132 màn hình |
| Public browser | 48 lượt probe: 12 đường dẫn × 1440/375 × sáng/tối; thêm 6 probe tablet 768; screenshot login/grammar/vocabulary/home | Nhiều route yêu cầu login; không coi màn hình login là đã test nội dung authenticated |
| User/admin workflows | Rerun 94 assertion fixture-backed trên local build cùng source release | Không phải 94 thao tác thật trên production hoặc kiểm tra mọi tổ hợp quyền |
| Backend | Inventory 55 router Python; audit trọng điểm upload/auth, logging, health, vocabulary rollout, session completion, hợp đồng lưu bài | Chưa pentest mọi endpoint, chưa gọi AI có phí hoặc chạy tải lớn |
| Database | Snapshot schema, ledger, policy, FK, storage; truy vấn toàn bộ public-table inventory production97/staging111 trong READ ONLY transaction | RLS enabled không chứng minh tất cả policy/RPC chống được mọi IDOR |
| Security dependencies | npm audit production dependency graph; đối chiếu advisory chính chủ Next và python-multipart với cấu hình/source | Chưa lấy SBOM từ container Railway; chưa audit toàn bộ dependency Python/transitive |

### Kết quả kiểm tra có thể giữ làm baseline

- Admin Class Detail: **27/27** — canonical reload, stale/error state, không biến unknown thành zero, keyboard tabs, escape nội dung.
- Admin Writing New: **8/8** — lost ACK/reconciliation, không replay POST mù, mobile actions.
- Listening Test Session: **9/9** — claim Next, autosave/reload, chặn submit khi save bị từ chối, retry, kết quả canonical.
- Reading Test listing: **15/15** — tổng canonical, malformed response, filter race, escape title. Đây là test listing, không phải toàn bộ Reading player.
- Mock Exam: **35/35** — Writing draft/recovery/collect, mất ACK, frozen embeds, mobile/mid-width/dark.
- 48 probe browser ban đầu không có uncaught JS error hoặc page-level horizontal overflow. `/reading`, `/writing` và probe phụ `/writing/tasks` là URL phỏng đoán trả404: **không ghi nhận là broken link** khi chưa chứng minh ứng dụng dẫn tới chúng. `/reading/test` canonical trả200. `/pricing` chuyển về home là hành vi source có chủ đích.
- Production `/health` và `/health/ready` trả200/statusok. GET ẩn danh `/admin/users`, `/admin/error-logs`, `/admin/cohorts`, `/sessions` đều401.
- 97/97 public tables production và111/111 staging có RLS. Không thấy invalid index/unvalidated constraint, không thấy public-schema SECURITY DEFINER executable bởi anon. Không có policy ghi `true` trong tập kiểm tra. Đây là kiểm tra catalog, không thay thế negative test hai tài khoản.
- Reading:585 submitted và Listening:1252 submitted, không dòng nào thiếu score/submitted_at.235 course Reading/Listening submissions không có score/correct/attempt_no ngoài range, không thiếu content_snapshot.
- Snapshot log lúc audit: không có log mới sau mốc00:53UTC ngày09/09 hoặc trong24h trước truy vấn. Khoảng quan sát ngắn, không chứng minh hệ thống hoàn toàn không lỗi.

## Findings đã xác minh ở mức source/schema/config

### F01 — Dependency frontend nằm trong các dải phiên bản có advisory

- **Severity: Medium; ưu tiên cao.** Scanner severity tối đa Critical; exploitability thực tế chưa xác nhận.
- **Root cause:** lockfile ghim Next16.2.10; npm audit trả5 package bị đánh dấu: Next, sharp, postcss, nanoid, baseline-browser-mapping (1critical/3high/1moderate là mức PACKAGE, không phải5 exploit xác nhận).
- **Files:** `frontend/package.json:32`, `frontend/package-lock.json:1088`, `frontend/next.config.ts:39`.
- **Validate/loại false positive:** Windows RCE GHSA-p293-qw3h-jr36 không phù hợp profile hiện tại có Cache Components; không kết luận production Vercel mắc Windows RCE. Không tìm thấy `use server`, `next/image`, remotePatterns hoặc middleware/proxy trong source kiểm tra; các advisory phụ thuộc chúng không tự động trở thành finding khai thác được. SVG advisory ghi rõ Vercel không bị ảnh hưởng. AVIF/sharp cần xác minh đường tối ưu ảnh và version runtime trước khi khẳng định exposure.
- **Minimal fix đề xuất:** nâng Next và dependency graph trong PR riêng, chọn bản đã vá các advisory áp dụng tại thời điểm thực hiện; advisory đã đọc nêu16.3.3 cho hai RCE. Không chạy `npm audit fix --force` mù hoặc chỉ đổi package.json mà giữ lockfile cũ.
- **Verification:** clean install/build/typecheck, redirect ownership, cache/RSC regression,94 workflow assertion và Gate E/F smoke trên release mới; quét lại lockfile và xác minh deployed version.
- **Nguồn chính chủ:** [AVIF/sharp](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [Windows conditions](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [SVG/Vercel exclusion](https://github.com/vercel/next.js/security/advisories/GHSA-q8wf-6r8g-63ch).

### F02 — Backend upload parser bị ghim ở phiên bản có DoS advisory

- **Severity: Medium; ưu tiên cao về availability.** Upstream đánh giá High; không gửi payload DoS vào production.
- **Root cause:** requirements ghim `python-multipart==0.0.12`; Nixpacks cài trực tiếp requirements. Router dùng Form/File trước khi handler kiểm tra quyền; giới hạn kích thước đặt bên trong handler không thay thế giới hạn parser.
- **Files:** `backend/requirements.txt:11`, `backend/nixpacks.toml` phase install, `backend/routers/grading.py:450`.
- **Evidence:** version nằm dưới0.0.18 của GHSA-59g5-xgcq-4qw3 và dưới0.0.27 của GHSA-pp6c-gr5w-3c5g. Luồng multipart hiện có trong grading và admin imports. Chưa lấy pip inventory của container đang chạy, chưa kiểm chứng giới hạn của Railway edge.
- **Minimal fix:** nâng parser cùng bộ FastAPI/Starlette tương thích, bổ sung giới hạn body/parser trước xử lý; audit dependency Python còn lại. Không coi0.0.18 là đủ vì còn advisory mới hơn.
- **Verification:** test malformed/bounded upload chỉ trên local, request thiếu auth, upload audio/CSV/ảnh/đề hợp lệ, lỗi413/422, sau đó xác minh artifact/container đã chạy bản vá.
- **Nguồn:** [Boundary DoS](https://github.com/Kludex/python-multipart/security/advisories/GHSA-59g5-xgcq-4qw3), [Unbounded headers, patched0.0.27](https://github.com/Kludex/python-multipart/security/advisories/GHSA-pp6c-gr5w-3c5g).

### F03 — Request autosave treo có thể giữ Reading/Listening ở trạng thái nộp bài vô hạn

- **Severity: Medium; ưu tiên cao về giữ bài.** Tái hiện được với transport không settle; không có bằng chứng đã mất bài của học viên thật.
- **Root cause:** coordinator chờ Promise save không deadline; API adapter chỉ hỗ trợ signal do caller truyền, không tạo timeout mặc định. Listening serializes writes nên một request treo còn chặn các câu tiếp theo. Trạng thái pending không được đưa vào snapshot; trước khi rejection, UI chưa phát retry/failed warning. Submit và mock-flush cùng chờ flush.
- **Files:** `frontend/lib/listening-test-controller.mjs:264,291,331`; `frontend/lib/reading-exam-controller.mjs:291,331`; `frontend/public/js/api.js:167`; Listening session `saveAnswer:456`, `submit:557`; Reading exam session `submit:928`, mock handler ngay sau đó.
- **Reproduction:** injected save(q1)=Promise không settle, q2 thành công; Listening chỉ gọiq1, Reading gọi cảq1/q2; cả hai snapshot rỗng và flush vẫn pending. Kiểm tra nguồn xác nhận không có timeout phía client. Đây không phải tình huống HTTP500/timeout đã reject mà9/9 smoke hiện có bao phủ.
- **Minimal fix:** deadline/AbortController có phân loại lỗi, pending/dirty generation tracking ngay khi edit, retry có giới hạn, submit/collect deadline và thông báo không làm mất bản nháp. Giữ idempotency và generation safety; timeout không được giả định server chưa ghi. Reading submit có gửi full answers nên giữ khả năng recovery đó.
- **Verification:** delayed/no-response save, late ACK, offline/online, chỉnh đáp án trong khi save, submit/hết giờ/pagehide, collect embed, reload; persisted answer phải bằng latest answer hoặc UI giữ rõ unsaved state.

### F04 — Admin Vocabulary Curated được dẫn tới schema chưa triển khai production

- **Severity: Medium.** Xác minh bằng schema thật + call chain; chưa mở trang bằng admin production.
- **Root cause:** production không có14 bảng curated và ledger234–239; staging có. Learner/public gate default-off hoạt động đúng (GET `/api/vocabulary/units` trả503 feature_disabled), nhưng editorial/pilot admin chỉ kiểm tra role, không kiểm tra rollout readiness. Admin workspace vẫn dẫn tới hai màn hình PILOT.
- **Files:** `frontend/app/(authed-admin-vocab)/admin/vocab/page.tsx:12`; `curated/admin-vocab-editorial.tsx:159`; `backend/routers/vocab_units.py:284,313`; `backend/services/vocab_units.py:583`; `backend/services/vocab_pilot_metrics.py:get_metrics`.
- **Impact:** admin hợp lệ vào editorial sẽ query `vocab_learning_units` không tồn tại và rơi vào500; pilot metrics cần RPC của migration238. Nhãn PILOT không ngăn gọi API. Không quy thiếu bảng cho tất cả phía học viên vì learner đã được chặn.
- **Minimal fix:** thêm readiness/rollout gate thống nhất cho admin, hiển thị “chưa triển khai môi trường này”; hoặc thực hiện rollout migrations sau phê duyệt riêng. Không apply toàn bộ233–239 tự động;233 là data repair khác scope.
- **Verification:** schema chưa có→controlled unavailable, không500; schema sẵn+gateon→canonical list/metrics; nonadmin403/401; không để thiếu schema trông như0 learning units.

### F05 — Bucket chứa ghi âm học viên đang public

- **Severity: Medium; ưu tiên privacy.** Cấu hình và phản hồi HEAD ẩn danh trên một object cụ thể đã được xác nhận. Chưa tải nội dung để thử GET, chưa có bằng chứng bên thứ ba đã truy cập hoặc có rò rỉ thực tế.
- **Root cause:** `storage.buckets.audio-responses.public=true`, chứa7597 objects. Upload tạo publicURL; endpoint audio-urls có ownership check và signedURL nhưng bucket public không tạo được cam kết “chỉ signedURL mới đọc được” bằng cấu hình hiện tại.
- **Files:** `backend/routers/grading.py:574`; `backend/routers/sessions.py:1173,1216`; storage bucket `audio-responses`.
- **HTTP proof sau owner approval:** ngày09/09/2026 lúc01:47:28UTC (08:47:28 giờ Việt Nam), chọn đúng một object liên kết `responses.audio_storage_path` có session bằng READ ONLY transaction, rồi gửi đúng một HEAD tới public URL của bucket. Kết quả **200 OK**, `Content-Type: audio/webm`, `Content-Length: 425627`; không Authorization/cookie, không signed token, không theo redirect, không tải/phát audio. Fingerprint SHA-256 của sample: `864ff243310d2fd6def3d0e4e33b2051a0083584956ec63079b98af49baf4df6`. Không lưu tên object/URL riêng tư. Chứng minh HEAD ẩn danh thành công trên sample, không suy thành log truy cập của bên thứ ba hoặc GET đã thử.
- **Authorization:** bước này ban đầu bị auto-review chặn; chỉ thực hiện sau khi owner trả lời “approved” cho yêu cầu HEAD một bản ghi. Không thay đổi quyền bucket, dữ liệu hoặc consumer.
- **Minimal fix đề xuất:** audit mọi consumer/fallback trước; lập kế hoạch private bucket + authenticated signedURL cho owner/admin, TTL và cache, khả năng phát audio cũ. Không flip bucket ngay vì có thể làm hỏng các consumer publicURL lịch sử. `vocab-audio`/`writing-images` public không tự động là lỗi vì phục vụ tài liệu công khai.
- **Verification:** với object thử nghiệm đã được cho phép: owner đọc được, nonowner bị chặn, publicURL bị từ chối, signedURL hết hạn; kiểm tra admin review và session cũ trước rollout.

### F06 — Migration verifier báo fail sai sau migration230

- **Severity: Medium; lỗi công cụ vận hành, không phải schema hỏng.**
- **Root cause:** verifier213–225 fingerprint chính xác toàn bảng nhưng profile mới nhất chỉ tính phần mở rộng226;230 thêm `attempt_no` và constraintpositive hợp lệ.
- **Files:** `backend/scripts/verify_prod_nextjs_migrations_213_225.sql:116`; `backend/migrations/230_course_section_attempts.sql:147`; wrapper `verify_prod_nextjs_migrations.py`.
- **Evidence:** wrapper hiện exit1 ở đúng2fingerprint của course_pronunciation_submissions. Truy vấn READ ONLY bỏ đúng cột/constraint bổ sung230 cho hash `5dba1a9cdba1722d03789db62a08b185`/21columns và `033f197219448de8299798632d1d4e4d`/10constraints: trùng hoàn toàn expected cũ.215–221 contracts VERIFIED.
- **Minimal fix:** cập nhật profile forward-floor230 được kiểm chứng; vẫn kiểm tra cột mới/default/constraint/RLS. Không bỏ fingerprint hoặc chấp nhận mọi superset không kiểm soát.
- **Verification:** current schema pass; cố tình sai type/default/constraint trong DBfixture phải fail; các floor được hỗ trợ được định nghĩa rõ.

### F07 — Readiness “migrations ok” chỉ đại diện năm bảng vocabulary cũ

- **Severity: Low; coverage gap vận hành.**
- **Root cause:** `_CRITICAL_TABLES` chỉ gồm5bảng migrations019–027; `/health/ready` vẫn tự mô tả comprehensive và trả migrationsok. F04 chứng minh readinessok không phản ánh readiness toàn bộ feature surface.
- **Files:** `backend/routers/health.py:67,87,114`.
- **Minimal fix:** readiness manifest theo các feature đang enabled, gồm table/column/RPC contract trọng yếu; vẫn để `/health` làm liveness nhẹ. Giữ HTTP200/body verdict nếu monitor hiện dùng contract này, không đổi status code mù.
- **Verification:** featureoff/missing schema→không falsealarm; featureon/missing schema→degraded; admin có chi tiết, anonymous không lộ database error.

### F08 — Frontend error ingestion chưa giới hạn payload extra tại application boundary

- **Severity: Medium; hardening gap được xác nhận từ source, chưa chứng minh abuse đang xảy ra.**
- **Root cause:** endpoint anonymous có giới hạn message/stack nhưng `extra: dict | None` không giới hạn byte/depth/cardinality và được ghi nguyên; không thấy rate/body-size guard ở endpoint hoặc middleware main. Các rate limit bài tập/grading ở service khác không bảo vệ endpoint này. Chưa kiểm chứng WAF/edge quota bên ngoài.
- **Files:** `backend/routers/error_logs.py:45,53,81,113`; `backend/main.py` middleware registration.
- **Minimal fix:** giới hạn size/depth của extra, redact trường nhạy cảm, rate limit/dedup có kiểm soát cho anonymous ingress. Không tắt toàn bộ error reporting hoặc tạo vòng lặp reporter báo lỗi cho chính nó.
- **Verification:** local request quá lớn/deep bị từ chối trước insert, request hợp lệ vẫn nhận; simulated burst được giới hạn, không ghi production log để thử tải.

### F09 — Login fine print quá nhạt ở cả sáng/tối

- **Severity: Low; accessibility/UX đã đo trên production.**
- **Root cause:** `.lx-fine-print` dùng `--av-text-faint` alpha0.32 cho nội dung cần đọc ở font12px, gồm hướng dẫn nhận access code.
- **Files:** `frontend/public/css/login-next.css:177`; `frontend/app/(public-auth)/login/login-behavior.tsx:268`.
- **Evidence:** light rgba(15,23,42,.32) trênrgb(250,250,249)≈2.05:1; dark rgba(241,245,249,.32) trênrgb(10,22,40)≈2.73:1 (alpha composite rồi tính luminance). Đây là đoạn hướng dẫn, không phải disabled/decorative text.
- **Minimal fix:** semantic text token phù hợp cho nội dung nhỏ; giữ faint cho decoration, không đổi mọi token toàn web trong cùng patch.
- **Verification:** đo lại rendered contrast trên375/768/1440 sáng/tối, đạt mục tiêu4.5:1 cho đoạn chữ nhỏ; không gây layout jump.

## Dữ liệu cũ cần triage riêng — không quy cho hard flip

-22Speaking sessions completed thiếu overall_band, đều bắt đầu06–19/04/2026.10có response score,11không córesponse; một session còn lại chưa thuộc hai nhóm đó. Một completed session thiếu completed_at cũng từ19/04. Root cause lịch sử chưa đóng; current `complete_session` đã có recompute/null-band guard (`sessions.py:2028,2045`). Cần phân loại theo canonical grading fields, test seeds, partial/failed attempt trước khi backfill. Không bịa điểm, không bắt người học làm lại hàng loạt.
- Query LEFT JOIN ban đầu trông như4orphanresponses; xác minh lại là4rows `session_id IS NULL`, **0non-null dangling FK**. Nullable contract hiện cho phép; chưa có căn cứ tự động xóa.
-45log chưa dismiss =41warning+4error, không phải45lỗi mới. Nhóm:23PronunciationDrilldown,9Chart.js,7session-not-found bootstrap,2Supabase SDK,2EmptyRanges,1syntaxerror,1ChunkLoadError. Đều có trước flip. Cần correlate URL/user-agent/release và tái hiện Safari/CDN/chunkcache trước khi sửa/dismiss. Không kết luận hết lỗi chỉ vì24h yên lặng.
- Staging ledger233–239 khác production:233data repair cần xử lý riêng,234–239curated pilot. Ledger renumbering215–218 lịch sử không được coi là bằng chứng duplicate apply hoặc tự chạy lại.
- Các nhánh/worktree cũ có thay đổi chưa merge không phải deployedtruth. Không merge nhánh prep lớn để “lấy hết fix”. Nếu chọn dùng một patch, audit từng diff trên main hiện tại.

## Kế hoạch xử lý và đóng audit

| Wave | Nội dung | Điều kiện đóng |
|---|---|---|
| 1 — Bảo vệ release | F01/F02 dependency, F03 save/submit | PR tách theo domain; kiểm tra advisory applicability, tests+build+staging; không khai thác DoS production |
| 2 — Đồng bộ vận hành | F04 admin rollout gate, F06 verifier, F07 readiness | Featureoff/on có contract đúng; actual-schema checks pass mà vẫn bắt drift |
| 3 — Privacy/observability | F05 storage, F08 ingestion; triage45log | Duyệt riêng thay đổi storage; kiểm tra consumer cũ; log được đóng theo evidence chứ không bulk dismiss |
| 4 — Dữ liệu/UX | Triage22sessions + timestamp, F09 contrast | Dry-run từngcohort, owner duyệt write; không thay bài hợp lệ; screenshot/theme checks |
| 5 — Audit sâu còn lại | Ma trận quyền2users+admin, paid AI/finalization/regrade, toàn bộ admin/user route variants, Safari, backend SBOM, query performance và restore drill | Synthetic account/data được cho phép; không dùng production learner làm test subject; evidence cho từng risk |

HEAD một audio object cụ thể của F05 đã được owner approved và hoàn thành; quyền này không bao gồm GET/tải audio, đổi bucket hoặc sửa sản phẩm. Những việc vẫn cần quyền bổ sung trước khi chạy: mọi repair dữ liệu/private-bucket flip, migration, deploy hoặc bài test tạo dữ liệu/chi phí. Chưa thực hiện chúng. Staging SSO chưa có phiên/bypass được cấu hình cho audit này; không vượt qua lớp bảo vệ. Các fixture pass không thay thế staging E2E thật.

## Evidence và cách tái kiểm tra

- Báo cáo giữ số liệu aggregate, không lưu token, email, transcript, tên object audio.
- Local scratch (không commit): `/tmp/aver-post-flip-schema-{production,staging}.json`, DB inventory/checks/triage SQL, migration-verifier output, npm audit JSON, browser JSON/screenshots, save-repro.mjs. `/tmp` là tạm thời, không coi là evidence lưu trữ vĩnh viễn.
- DB queries đều `BEGIN TRANSACTION READ ONLY`, statementtimeout15–20s. No mutation.
- Browser public chặn mọi method ngoàiGET/HEAD/OPTIONS; không tạo analytics/error logs. Fixture scripts intercept business APIs, không gửi mutation thật.
- UI review skill ảnh hưởng cách kiểm tra rendered sáng/tối, kích thước và failure/recovery, không ép layout thi hoặc editorial vào một kiểu card chung. Findings UI hiện hành được dẫn ở `specs/general/UI-IMPROVEMENTS.md`.

Không có kết luận “toàn bộ web đã sạch lỗi”. Đây là baseline có kiểm chứng để ưu tiên remediation, rồi tiếp tục đóng các khoảng coverage còn lại.
