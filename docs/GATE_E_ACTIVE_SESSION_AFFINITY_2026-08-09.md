# Gate E active-session affinity — 2026-08-09

**Trạng thái:** MECHANISM READY; LIVE CORE DRILL PENDING. Batch này không tuyên
bố Gate E PASS và không giả lập một player Next chưa tồn tại thành evidence thật.

## Finding

- **Root cause:** core player hiện chạy ở URL legacy cố định, nhưng không có một
  admission policy chung, signed proxy/control plane hoặc finite maximum
  active-session TTL cho mọi domain. Speaking session, listening attempt và
  writing assignment không đồng loạt có một expiry cưỡng chế; vì vậy chiến lược
  “chờ hết TTL rồi xoá legacy” không có điểm kết thúc có thể kiểm chứng.
- **Severity:** Critical — một atomic ownership flip hoặc deployment rollback có
  thể đưa tab reload sang implementation khác khi attempt đang ghi dữ liệu.
- **Impacted files/functions:** sáu launcher Next của Speaking, Reading và
  Listening; các entry point legacy còn lại; các player legacy dưới
  `frontend/public/pages/`; future player Next; `/writing/dashboard` đã cutover;
  cutover/rollback runbook của từng core cluster.
- **Minimal fix trong batch:** chọn URL-level implementation affinity và gom nơi
  nhận attempt mới vào `frontend/lib/core-player-affinity.mjs`. Hiện admission
  vẫn là `legacy`, nên hành vi production không đổi. Target Next bị fail-closed
  bằng `route_ready: false` cho tới khi dark route thật và browser tests tồn tại.
- **Verification:** Node drill chứng minh legacy-start → cutover vẫn legacy,
  Next-start → rollback vẫn Next; flip sớm, identity thiếu, query lạ đều bị chặn.
  Live staging drill phải chạy lại trên player thật của từng cluster.

## Quyết định kiến trúc

Không dùng Rolling Releases cho core flow và không dùng query flag làm affinity.
Query flag không phải affinity: nó không ký, dễ mất khi redirect và vẫn để cùng
một pathname đổi owner khi reload.

Mỗi implementation có URL ổn định riêng:

| Surface | Legacy stable URL | Next stable URL | Admission hiện tại |
|---|---|---|---|
| Speaking | `/pages/practice.html` | `/practice/session` | legacy |
| Reading exam | `/pages/reading-exam.html` | `/reading/exam/session` | legacy |
| Listening test | `/pages/listening-test.html` | `/listening/test/session` | legacy |
| Listening dictation | `/pages/listening-test-dictation.html` | `/listening/dictation/session` | legacy |
| Writing dashboard | `/pages/writing-dashboard.html` | `/writing/dashboard` | Next — cutover trước batch này |

URL chỉ chọn renderer; backend auth/ownership vẫn quyết định ai được đọc hoặc
ghi attempt. Biết một URL Next không cấp thêm quyền dữ liệu.

### Ranh giới coverage hiện tại

`core-player-affinity.mjs` hiện chỉ là nguồn admission của sáu launcher Next cho
Speaking/Reading/Listening đã liệt kê trong executable test. Các launcher legacy
như mock-exam runner và My Class vẫn cố ý mở player legacy; chúng chưa được gọi
là đã cutover và phải được chuyển theo cluster tương ứng. Vì thế local drill
không chứng minh “mọi attempt mới của toàn hệ thống” đã qua một global switch.

Writing là trường hợp có trước foundation: `/writing/dashboard` đã là Next,
trong khi `/pages/writing-dashboard.html` vẫn sống làm vế parity/rollback. Nó ở
ngoài helper mới vì attempt được mở ngay trong dashboard, không qua sáu launcher
trên. Gate E của Writing vẫn phải pin coexistence rollback floor và drill modal
đang viết, autosave, reload, submit cùng canonical server draft; không được lấy
coverage Speaking/Reading/Listening thay cho evidence Writing.

## State machine cutover/rollback

1. **Foundation:** launcher gọi admission policy; mọi target vẫn legacy.
2. **Dark route:** xây stable Next player, parity/resume/failure tests xanh, rồi
   đổi riêng `next.route_ready` sang true. Chưa đổi admission. Ghi exact commit
   này làm **rollback floor SHA**: mọi deployment rollback khi còn active Next
   attempt phải mới hơn hoặc bằng floor và còn phục vụ cả hai stable URL.
3. **Cutover:** đổi `admit_new` sang Next. Attempt mới nhận URL Next; tab legacy
   đang mở hoặc URL legacy được copy sang tab mới vẫn ở legacy.
4. **Rollback:** đổi `admit_new` về legacy, hoặc deployment-rollback về đúng
   coexistence floor SHA. Attempt Next đang mở vẫn dùng URL Next; không xoá dark
   route, không rollback về deployment trước floor, không chuyển renderer giữa
   attempt.
5. **Retirement:** chỉ retire legacy sau Gate F khi telemetry của stable legacy
   URL chứng minh zero legitimate request trong cửa sổ bắt buộc. Vì hiện không
   có finite maximum active-session TTL toàn hệ thống, không được suy diễn rằng
   thời gian trôi tự đóng điều kiện này; cần zero-active query hoặc exception có
   owner trước retirement.

## Drill đã chạy trong batch

`frontend/tests/gate-e-active-session-affinity.test.mjs` chạy cùng implementation
policy thật và kiểm:

- current admission sinh legacy URLs có cùng path và query semantics cho bốn
  surface;
- legacy attempt không đổi URL sau cutover;
- Next attempt không đổi URL sau rollback;
- attempt mới sau rollback quay về legacy;
- target Next chưa ready, thiếu identity, query ngoài allowlist hoặc
  implementation lạ đều fail closed;
- sáu canonical Next launcher không còn hardcode player destination rời rạc.

## Evidence còn thiếu trước khi đóng Gate E

- Speaking đã có `/practice/session` dưới App Router nhưng mới là legacy-behavior
  bridge và vẫn `route_ready: false`; cần native player Next thật cho từng core
  cluster cùng canonical backend-state assertions.
- Mọi entry point tạo attempt của cluster phải đi theo admission decision hoặc
  được ghi rõ là một cohort legacy có chủ đích; không suy rộng sáu launcher thành
  global coverage.
- Staging browser drill gồm tab cũ, reload, copy URL sang tab mới, cutover và
  rollback; artifact phải ghi source/backend release, rollback floor SHA và
  attempt/session ID.
- Full-test chain fresh-client boundary; ambiguous commit; partial persistence;
  legacy↔Next bidirectional resume.
- Quyết định zero-active/TTL cho retirement; batch này chỉ ngăn đổi
  implementation giữa attempt, không tự giải quyết Gate F.
