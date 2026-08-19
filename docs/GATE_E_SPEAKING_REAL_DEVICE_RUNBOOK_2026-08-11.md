# Gate E Speaking — real-device evidence runbook — 2026-08-11

**Trạng thái:** RUNNER READY; SAFARI/iOS ARTIFACTS PENDING. Batch này không đổi
`route_ready` hoặc `admit_new`, và không coi Playwright WebKit là Safari/iOS thật.

> **Amendment 2026-08-19:** hai hàng real-device được re-pin từ floor hardware
> (macOS 12.5/Safari 15.6, iOS 15.8.5) sang thiết bị thật đang có
> (`safari-desktop` = macOS 26.5.2/Safari 26.5.2, `ios-safari` = iPhone 17 Pro,
> iOS 26.6). Quyết định owner + waiver floor-hardware ghi tại
> `docs/GATE_E_REAL_DEVICE_REPIN_2026-08-19.md`. Mọi nhắc tới Safari 15.6/iOS
> 15.8.5 trong phần Finding bên dưới là lịch sử của batch 2026-08-11.

## Finding

- **Root cause:** matrix đã liệt kê Safari 15.6 và iOS 15.8.5 nhưng chỉ có hai
  dòng `pending`; chưa có schema, validator hay workflow buộc một attestation
  thủ công vào đúng release staging và dữ liệu phiên canonical.
- **Severity:** Critical — một ghi chú hoặc ảnh chụp rời rạc có thể bị gắn nhầm
  SHA, bỏ sót scope microphone/reload, hoặc được dùng để mở Gate E dù response
  chưa bao giờ persist.
- **Impacted files/functions:**
  `frontend/tooling/gate-e-speaking-device-matrix.json` phần
  `real_device_requirements`; cổng Gate E đọc `real_devices_complete` trong
  `frontend/tooling/gate-e-streak-lib.mjs`; trước batch không có artifact thật
  để chuyển hai dòng này sang `complete`.
- **Minimal fix:** workflow chỉ được dispatch từ revision tin cậy `main`, dùng
  auditor/script ở `main` để checkout và kiểm candidate `staging`; đối chiếu
  frontend và backend cùng SHA đang phục vụ, đọc lại session của tài khoản
  synthetic từ API, yêu cầu đủ exact scope/zero console-network failure, rồi
  xuất artifact theo JSON schema. Hai artifact chỉ hợp lệ khi cùng một
  `source_sha`, hai workflow run khác nhau và metadata run khớp GitHub API.
- **Verification:** unit test fail-closed cho version/scope/time/release/session,
  source contract cho workflow và schema; sau khi chạy thật, dùng pair verifier
  ở bước 4. Không sửa status manifest trước khi cả hai artifact đều xanh.

## 1. Điều kiện trước khi thao tác thiết bị

1. Candidate đã merge vào branch `staging`; Vercel staging và Railway staging
   phải cùng phục vụ exact SHA đó. Workflow sẽ kiểm lại, không nhận khai báo tay.
2. Dùng tài khoản synthetic `e2e-student-smoke@staging-e2e.averlearning.com`.
   Không ghi password, token, transcript hoặc feedback vào input/artifact.
3. Thiết bị phải đúng một trong hai hàng versioned:
   - `safari-desktop`: macOS 26.5.2, Safari 26.5.2;
   - `ios-safari`: iOS 26.6, Mobile Safari đi kèm (iPhone 17 Pro).
4. Bật Safari Web Inspector để theo dõi console và network. Một lỗi console hay
   request thất bại liên quan journey làm artifact không đủ điều kiện; sửa lỗi
   rồi chạy journey mới, không sửa attestation cũ.

## 2. Journey trên thiết bị thật

Trước khi bấm tạo phiên, ghi UTC timestamp làm `journey_started_at`. Từ
`/speaking`, tạo một phiên Practice Part 2 **mới** bằng tài khoản synthetic, rồi
mở stable URL `/practice/session?session_id=...`. Không tái dùng session có sẵn.
Ghi UUID session, submit tối thiểu một bản ghi và lấy `response_id` trong response
của request POST làm `canonical_response_id`. Cùng response đó phải có
`backend_release_sha` 40 ký tự; ghi exact giá trị làm
`observed_backend_release_sha`. Đây là marker của backend thực sự đã persist
recording, không được thay bằng giá trị đọc từ một request chạy sau. Backend lưu
`responses.persisted_at` bằng đồng hồ server và endpoint canonical trả timestamp
này trong response/receipt; workflow sẽ từ chối nếu exact response được persist
trước `journey_started_at` hoặc sau `observed_at`. Vì vậy phải ghi `observed_at`
sau khi POST thành công và hoàn tất toàn bộ scope. Chỉ phát lại blob cục bộ hoặc
chỉ đếm một response cũ không chứng minh persistence của journey này.

Ngay trong journey, mở `/js/runtime-config.js` trên cùng staging origin và ghi
exact giá trị 40 ký tự của trường `release` làm `observed_release_sha`. Nếu
release marker đổi trước khi hoàn tất các scope, bỏ journey đó và chạy lại trên
một release ổn định; không dùng marker đọc sau journey để chứng nhận thao tác cũ.

### Safari desktop (`safari-desktop`, macOS 26.5.2 · Safari 26.5.2)

Hoàn tất đủ năm scope sau:

1. `real-microphone-permission-denied-and-retry` — từ chối quyền, thấy copy lỗi,
   cho phép lại và retry ngay trong state hiện tại.
2. `record-stop-playback` — record, stop và phát lại đúng audio vừa thu.
3. `background-tab-and-return` — đưa tab xuống nền rồi quay lại, state không tự
   hoàn thành hoặc mất take.
4. `reload-resume` — submit một response, reload stable URL và đọc lại đúng
   phiên/câu từ backend.
5. `route-exit-microphone-release` — rời route và xác nhận chỉ báo microphone
   tắt/track đã được giải phóng.

### iOS Mobile Safari (`ios-safari`, iPhone 17 Pro · iOS 26.6)

Hoàn tất đủ sáu scope:

1. `touch-record-stop-playback`;
2. `real-microphone-permission-denied-and-retry`;
3. `home-screen-background-and-return`;
4. `orientation-and-horizontal-overflow` ở portrait và landscape;
5. `reload-resume` sau khi response đã persist;
6. `route-exit-microphone-release`.

## 3. Phát hành artifact

Trong GitHub Actions, chạy workflow **Speaking Gate E real-device evidence** từ
branch `main`. Workflow dùng code kiểm định ở `main`, tự checkout candidate
`staging` riêng để kiểm release đang phục vụ; dispatch từ branch khác sẽ fail.
Nhập platform/browser đúng nguyên văn trong matrix, session ID, UTC
`journey_started_at`, `observed_at`, `canonical_response_id`,
`observed_release_sha`, `observed_backend_release_sha` đã ghi trong journey,
operator và JSON scope. Ví dụ Safari:

```json
{
  "real-microphone-permission-denied-and-retry": "passed",
  "record-stop-playback": "passed",
  "background-tab-and-return": "passed",
  "reload-resume": "passed",
  "route-exit-microphone-release": "passed"
}
```

`console_errors_json` và `network_failures_json` phải là `[]`. Attestation phải
được phát hành trong 12 giờ sau journey; canonical session phải bắt đầu không
quá 3 giờ trước `observed_at`, nên không thể tái dùng một session cũ. Workflow
chỉ nhận artifact khi `observed_release_sha` và
`observed_backend_release_sha` đều đúng bằng candidate SHA mà Vercel staging và
Railway staging đang phục vụ. Marker backend trong response journey cũng phải
khớp provenance backend workflow đọc sau đó, nên deploy lệch nhịp sẽ fail thay
vì ghép hai runtime khác nhau. Workflow rerun không đủ điều kiện;
sửa input bằng một workflow run mới để không cherry-pick lần chạy lại thành PASS.

Workflow luôn upload artifact, kể cả khi fail. Artifact hợp lệ phải có
`status: "complete"`; `status: "invalid"` chỉ phục vụ chẩn đoán và không được
dùng để đổi manifest.

## 4. Ghép cặp và handoff

Từ branch `main`, chạy workflow **Speaking Gate E real-device pair
verification** với hai run ID và exact 40-character staging SHA. Workflow tải
đúng artifact có tên gắn với từng run bằng GitHub Actions API, kiểm toàn bộ
schema/semantic scope/canonical session, rồi đối chiếu metadata của từng run với
GitHub API. Không dùng file JSON tải tay làm bằng chứng admission canonical.

Pair chỉ PASS khi đủ đúng hai requirement, hai run ID khác nhau, hai run đều là
`workflow_dispatch` thành công lần đầu trên trusted `main`, cùng matrix và cùng
một `source_sha` trên `staging`. Sau đó mới mở PR evidence-only cập nhật hai dòng
manifest sang `complete` kèm run ID/SHA; thay đổi manifest sẽ reset streak, vì
vậy chuỗi 20 critical-suite run bắt đầu sau PR đó.

## 5. Ranh giới quyết định

Hai artifact thật chỉ đóng mục device matrix. Chúng không thay thế live
`floor → cutover → rollback` drill, failure-injection coverage hay chuỗi 20 run.
Không bật `route_ready`, không đổi `admit_new`, và không retire Legacy từ riêng
batch evidence này.
