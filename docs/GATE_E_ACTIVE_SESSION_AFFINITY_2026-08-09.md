# Gate E active-session affinity — 2026-08-09

**Trạng thái:** SPEAKING THREE-PHASE LIVE CORE DRILL PASSED; REAL DEVICE + GATE E
PENDING. Floor `32043317793`, cutover `32045284608` và forward rollback
`32047774312` đã chứng minh hai renderer giữ affinity canonical trên matching
frontend/backend staging provenance. Staging hiện `admit_new=legacy`; không tuyên
bố Gate E PASS hoặc production cutover.

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
  nhận navigation mới là nơi đọc `admit_new`. `sessions.renderer_affinity` được
  backfill Legacy cho session cũ. Migration 216 đặt default `legacy` cho mọi
  insert N−1/unversioned; chỉ `api.js` hiện tại gửi protocol `claim-v1` để RPC v3
  tạo atomically một row NULL cho stable player đầu tiên claim. Migration 217
  backfill cả row NULL có thể lọt vào khoảng commit riêng giữa 215→216. Vì vậy cả
  tab cũ mở sau migration lẫn tab mới đều giữ đúng renderer. Reopen dùng claim canonical
  thay vì re-admit. Production và floor staging đều giữ Legacy; cả bốn target
  Next vẫn `route_ready: true`.
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
| Speaking | `/pages/practice.html` | `/practice/session` | legacy trên staging sau forward rollback đã verify; active Next session vẫn giữ `/practice/session`; production chưa đổi |
| Reading exam | `/pages/reading-exam.html` | `/reading/exam/session` | legacy — Next dark route ready; failure/coexistence evidence pending |
| Listening test | `/pages/listening-test.html` | `/listening/test/session` | legacy — Next dark route ready; failure/coexistence evidence pending |
| Listening dictation | `/pages/listening-test-dictation.html` | `/listening/dictation/session` | legacy — Next dark route ready; failure/coexistence evidence pending |
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
trên. Writing đã có automated synthetic modal/autosave/reload/submit matrix
riêng từ 2026-08-14, gồm exact-text idempotent readback và bidirectional
Legacy/Next. Gate E của Writing vẫn phải pin coexistence rollback floor và chạy
live staging drill trên canonical services; synthetic coverage không thay
operational evidence.

## State machine cutover/rollback

1. **Foundation:** launcher luôn sinh URL `/core-player/launch` không chứa quyết
   định implementation. Request runtime no-store đọc policy của deployment hiện
   tại và tạm redirect 307; mọi target vẫn legacy.
2. **Dark route:** xây stable Next player, parity/resume/failure tests xanh, rồi
   đổi riêng `next.route_ready` sang true. Chưa đổi admission. Ghi exact commit
   này làm **rollback floor SHA**: mọi deployment rollback khi còn active Next
   attempt phải mới hơn hoặc bằng floor và còn phục vụ cả hai stable URL.
3. **Cutover:** đổi `admit_new` sang Next. Kể cả launcher đã mở trước deployment,
   click mới vẫn hỏi runtime hiện tại và nhận URL Next. Stable player đầu tiên
   atomically claim renderer cho session mới; mọi reopen sau đó đọc claim này
   và đi thẳng stable URL, không re-admit. Tab legacy đang mở hoặc URL legacy
   được copy sang tab mới vẫn ở legacy.
4. **Rollback:** đổi `admit_new` về legacy, hoặc deployment-rollback về đúng
   coexistence floor SHA. Launcher đã cache từ release cutover vẫn gọi cùng
   endpoint và request mới quay về legacy; attempt Next đang mở vẫn dùng URL
   Next. Không xoá dark route, không rollback về deployment trước floor, không
   chuyển renderer giữa attempt. Ưu tiên forward-revert commit hậu duệ của floor
   để không rewrite/force-push lịch sử `staging`; runner v2 ghi rõ
   `rollback_mode=forward-revert` hoặc `exact-floor`.
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
  phía deployment hiện tại chọn đúng renderer theo policy mà không đổi query semantics;
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

Speaking đã có versioned **three-phase runner** ở
`.github/workflows/speaking-coexistence-drill.yml`. Runner checkout đúng nhánh
`staging`, dùng chung concurrency gate với staging E2E, và xuất artifact riêng
cho `floor → cutover → rollback`. Floor bắt buộc checkout đúng rollback floor
SHA; cutover phải là descendant của floor. Rollback chấp nhận đúng floor hoặc
một forward-revert descendant của chính cutover, nhưng không chấp nhận lại
cutover SHA; browser vẫn phải chứng minh admission đã về Legacy. Cutover/rollback còn
phải tải artifact của workflow run ngay trước, kiểm phase, floor SHA, source ↔
frontend/backend release, nhánh `staging` và session ID handoff trước khi mở
browser. Mỗi phase tạo attempt qua admission thật, mở lại implementation URL của
attempt cũ, reload/copy URL sang tab mới và đọc cùng session từ backend canonical.
`floor_dark_next_url` cùng session id và affinity `null → next` chỉ bắt buộc ở
phase floor; session admission đã claim Legacy không được tái dùng để giả lập
dark Next. Hai phase sau không giả lập evidence này bằng `null`. Floor artifact
run `32043317793` đã pass trên rollback floor
`e96c2cdcc999979f645d16432f5cfd007d8383e8`: admission tạo session Legacy
`b8964c1e-686e-460d-a531-457b07b6dea7`; dark Next session
`feb819c2-0cc8-45d7-b33d-088d2bf73754` đổi affinity canonical `null → next`;
cả hai URL đều reload/copy được và frontend/backend provenance cùng trỏ
`staging@e96c2cd`. Cutover run `32045284608` trên `staging@1398c50` đã giữ
session Legacy cũ và tạo session Next
`64c53046-4889-4008-a1b0-768af1a00a7d`; cả hai reload/copy được, canonical
affinity lần lượt là `legacy` và `next`, provenance `ok:true`. Forward rollback
run `32047774312` trên `staging@28b23569` giữ session Next đó, tạo session Legacy
`b2afe17c-f752-42aa-be5e-74a846d1455e`, pass reload/copy và ghi
`rollback_mode=forward-revert`; provenance `ok:true`. Ba artifact thật dùng cùng
rollback floor SHA đã đóng riêng live Speaking drill; chúng không đóng Gate E,
real-device matrix hoặc các cluster khác. Vì request mang credential staging thật, runner
tắt trace/screenshot và không upload browser report có thể giữ header bí mật.

- Speaking đã có `/practice/session` dưới App Router và React sở hữu auth,
  bootstrap session/question, MediaRecorder, submission, Full Test
  retry/resume/finalize, player lifecycle và structured renderer; backend pin đủ
  ba part, cùng sitting, đúng 9/1/5 và exact `question_id` coverage. Browser
  fixture/failure/cross-version matrix đã xác lập `route_ready: true`; persisted-
  affinity floor gồm create protocol N−1-safe đã deploy và pass. Cutover cùng
  forward rollback `admit_new=legacy` đều đã pass. Real Safari/iOS vẫn chặn Gate E
  và production cutover.
- Mọi entry point tạo attempt của cluster phải đi theo admission decision hoặc
  được ghi rõ là một cohort legacy có chủ đích; không suy rộng sáu launcher thành
  global coverage.
- Staging browser drill gồm tab cũ, reload, copy URL sang tab mới, cutover và
  rollback; artifact phải ghi source/backend release, rollback floor SHA và
  attempt/session ID. Khi dispatch cutover/rollback phải truyền cả workflow run
  ID trước đó và đúng session ID do artifact run đó phát ra.
- Full-test chain fresh-client boundary; ambiguous commit; partial persistence;
  legacy↔Next bidirectional resume.
- Quyết định zero-active/TTL cho retirement; batch này chỉ ngăn đổi
  implementation giữa attempt, không tự giải quyết Gate F.
