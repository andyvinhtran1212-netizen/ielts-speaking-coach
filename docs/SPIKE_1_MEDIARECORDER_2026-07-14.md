# SPIKE 1 — MediaRecorder/audio dưới React (Safari/iOS/Chromium)

Plan Phase 2, critical-risk spike #1. **Artifact:** route dark `/recorder-spike`
(`frontend/app/(spike)/recorder-spike/` — port trung thực pipeline
practice.js:290-433 sang React, kèm harness mount/unmount) + suite
`playwright.spike.config.js` / `tests/spike/recorder.spec.js` (Chromium fake-mic
+ WebKit engine). Trang spike đồng thời là TRANG PROTOCOL cho manual test
Safari/iOS thật (panel diagnostics + hướng dẫn in trên trang).

## Exit criteria & phán quyết

| Tiêu chí | Kết quả | Bằng chứng |
|---|---|---|
| Ghi âm → blob thật, MIME đúng engine | ✅ Chromium (`audio/webm;codecs=opus`) + ✅ WebKit (hỗ trợ cả webm lẫn mp4 — mp4 là lane Safari cũ) | spec test 1, chạy 2 engine |
| Chunking 250ms thật sự tick | ✅ | `chunks > 2` sau 3s |
| React StrictMode double-mount không hỏng | ✅ | dev StrictMode: mount→cleanup→mount; ghi âm vẫn sạch sau đó |
| **Unmount GIỮA LÚC GHI giải phóng mic** (rủi ro số 1) | ✅ | cleanup dừng recorder + track (`stopped-by-cleanup`), remount ghi lại được — không zombie recorder, không kẹt indicator |
| Permission denial UX | ✅ (port nguyên mapping lỗi legacy: NotAllowed/NotFound/NotReadable) | component + manual protocol |
| **Upload multipart contract legacy → grade** | ✅ | blob ghi từ browser → `POST /sessions/{id}/responses` (FormData `question_id` + `audio_file`) → staging Railway fixture → HTTP 200 |
| AudioContext suspended→resume (rủi ro Safari) | ✅ WebKit: `suspended` → `resume()` → `running` trong user-gesture | debug probe |

**Phán quyết: PASS trên phạm vi tự động hóa được.** MediaRecorder dưới React
không có rào cản kiến trúc; toàn bộ pipeline legacy port được 1:1, và phần
React-đặc-thù (lifecycle) kiểm soát được bằng cleanup kỷ luật.

## Phát hiện trong spike

1. **WebKit automation: getUserMedia lần 2 sau navigation TREO VĨNH VIỄN**
   (không resolve, không reject) khi lần 1 đã acquire+stop rồi navigate.
   Ảnh hưởng: viết E2E cho WebKit phải one-page-load-one-acquisition; KHÔNG
   probe-rồi-goto-lại. (Có thể chỉ là quirk mock-device của Playwright WebKit —
   nhưng là bẫy thật cho CI.)
2. **Hydration race**: click vào button trước khi React hydrate = click chết.
   Mọi E2E cho trang Next tương tác phải chờ signal hydration (spike dùng
   `__spikeDiag.mounted` từ effect).
3. Cleanup phải `rec.onstop = null` TRƯỚC khi stop trong unmount (legacy đã
   biết bài này ở `_resetRecorder` — giữ nguyên khi port).
4. `pickMime` ladder của legacy hoạt động nguyên vẹn trên cả hai engine.

## Rủi ro tồn dư (chấp nhận có điều kiện)

- **iOS Safari thiết bị thật KHÔNG tự động hóa được** trong CI hiện tại.
  Trang `/recorder-spike` là protocol manual (5 bước in trên trang). Điều kiện
  trước cutover practice page: chạy manual protocol trên ≥1 iPhone thật
  (Safari) và ghi kết quả vào cutover sheet. Desktop Safari ≈ WebKit đã cover.
- Waveform canvas không port trong spike (analyser attach ĐÃ cover — phần vẽ
  là UI thuần, rủi ro thấp).
