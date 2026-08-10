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
- **Minimal fix trong batch:** chọn URL-level implementation affinity, gom policy
  vào `frontend/lib/core-player-affinity.mjs` và buộc launcher đi qua endpoint
  runtime no-store `frontend/app/core-player/launch/route.ts`. Bundle launcher
  chỉ giữ surface/query, không giữ quyết định `legacy`/`next`; deployment đang
  nhận navigation mới là nơi đọc `admit_new`. Hiện admission vẫn là `legacy`,
  nên hành vi production không đổi. Target Next bị fail-closed bằng
  `route_ready: false` cho tới khi dark route thật và browser tests tồn tại.
- **Verification:** Node contract chứng minh URL trong bundle đã cache không đổi
  qua cutover/rollback nhưng runtime hiện tại đổi được đích Next về legacy;
  legacy-start và Next-start vẫn giữ URL implementation-specific của chính nó.
  Flip sớm, identity thiếu, query lạ hoặc query trùng đều bị chặn. Live staging
  drill phải chạy lại trên player thật của từng cluster.

## Quyết định kiến trúc

Không dùng Rolling Releases cho core flow và không dùng query flag làm affinity.
Query flag không phải affinity: nó không ký, dễ mất khi redirect và vẫn để cùng
một pathname đổi owner khi reload. Tham số `surface` của `/core-player/launch`
chỉ định danh contract cần resolve; nó không cho client chọn implementation và
không được chuyển tiếp sang player.

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

`core-player-affinity.mjs` cùng `/core-player/launch` hiện chỉ là nguồn admission
của sáu launcher Next cho Speaking/Reading/Listening đã liệt kê trong executable
test. Các launcher legacy
như mock-exam runner và My Class vẫn cố ý mở player legacy; chúng chưa được gọi
là đã cutover và phải được chuyển theo cluster tương ứng. Ngoài ra,
`frontend/public/js/listening-test-player.js` còn mở dictation từ màn kết quả;
cross-player entry này cũng phải đi qua admission policy khi migrate Listening.
Vì thế local unit test không chứng minh “mọi attempt mới của toàn hệ thống” đã
qua một global switch.

Writing là trường hợp có trước foundation: `/writing/dashboard` đã là Next,
trong khi `/pages/writing-dashboard.html` vẫn sống làm vế parity/rollback. Nó ở
ngoài helper mới vì attempt được mở ngay trong dashboard, không qua sáu launcher
trên. Gate E của Writing vẫn phải pin coexistence rollback floor và drill modal
đang viết, autosave, reload, submit cùng canonical server draft; không được lấy
coverage Speaking/Reading/Listening thay cho evidence Writing.

## State machine cutover/rollback

1. **Foundation:** launcher luôn sinh URL `/core-player/launch` không chứa quyết
   định implementation. Request runtime no-store đọc policy của deployment hiện
   tại và tạm redirect 307; mọi target vẫn legacy.
2. **Dark route:** xây stable Next player, parity/resume/failure tests xanh, rồi
   đổi riêng `next.route_ready` sang true. Chưa đổi admission. Ghi exact commit
   này làm **rollback floor SHA**: mọi deployment rollback khi còn active Next
   attempt phải mới hơn hoặc bằng floor và còn phục vụ cả hai stable URL.
3. **Cutover:** đổi `admit_new` sang Next. Kể cả launcher đã mở trước deployment,
   click mới vẫn hỏi runtime hiện tại và nhận URL Next. Tab legacy đang mở hoặc
   URL legacy được copy sang tab mới vẫn ở legacy.
4. **Rollback:** đổi `admit_new` về legacy, hoặc deployment-rollback về đúng
   coexistence floor SHA. Launcher đã cache từ release cutover vẫn gọi cùng
   endpoint và request mới quay về legacy; attempt Next đang mở vẫn dùng URL
   Next. Không xoá dark route, không rollback về deployment trước floor, không
   chuyển renderer giữa attempt.
5. **Retirement:** chỉ retire legacy sau Gate F khi telemetry của stable legacy
   URL chứng minh zero legitimate request trong cửa sổ bắt buộc. Vì hiện không
   có finite maximum active-session TTL toàn hệ thống, không được suy diễn rằng
   thời gian trôi tự đóng điều kiện này; cần zero-active query hoặc exception có
   owner trước retirement.

**Hard invariant:** dark-route readiness/floor và admission cutover phải ở
**khác PR và khác commit**. PR/commit A bật `next.route_ready`, merge và deploy
để xác lập rollback floor; chỉ PR/commit B, là descendant đã được verify của
floor đó, mới được đổi `admit_new` sang `next`. Không được gộp hai thay đổi rồi
coi revert commit là rollback an toàn, vì revert đó sẽ xoá chính route mà active
Next attempt còn cần.

Endpoint `/core-player/launch` cũng là một phần của rollback floor ngay khi có
launcher nào phát hành URL đó. Trong thời gian tab/bundle cũ còn hợp lệ, không
được rollback thấp hơn release đầu tiên phục vụ endpoint; nếu không request từ
launcher cũ sẽ thành 404 trước khi policy có cơ hội đưa nó về legacy.

## Unit contract đã chạy trong batch

`frontend/tests/gate-e-active-session-affinity.test.mjs` chạy cùng implementation
policy thật và kiểm:

- launcher sinh URL runtime implementation-neutral cho bốn surface, còn resolver
  phía deployment hiện tại sinh legacy URL có cùng path/query semantics;
- legacy attempt không đổi URL sau cutover;
- Next attempt không đổi URL sau rollback;
- cùng URL đã cache từ launcher cutover được runtime rollback đưa attempt mới về
  legacy;
- target Next chưa ready, thiếu identity, query ngoài allowlist hoặc
  implementation lạ đều fail closed; route runtime từ chối key trùng lặp và gửi
  `Cache-Control`, `CDN-Cache-Control`, `Vercel-CDN-Cache-Control` no-store;
- sáu canonical Next launcher không còn hardcode player destination rời rạc;
- recursive guard quét `frontend/app`, `frontend/components` và `frontend/lib`
  (whitelist duy nhất là policy source) để shared helper mới không lách admission.

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
