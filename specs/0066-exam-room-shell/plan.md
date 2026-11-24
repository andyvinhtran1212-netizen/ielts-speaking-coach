# Implementation plan

## Architecture impact

- Chỉ frontend. Thư mục mới:
  - `frontend/components/exam-room/`: `exam-room-shell.tsx`, `split-pane.tsx`,
    `question-navigator.tsx`, `submit-dialog.tsx`, `abandon-dialog.tsx`,
    `connection-banner.tsx`, `session-expired-dialog.tsx`, `save-status.tsx`,
    `other-tab-notice.tsx`, `time-up-choice.tsx`,
    `audio-player.tsx`, `annotation-layer.tsx`, `exam-room.module.css`.
  - `frontend/components/exam-room/questions/`: một file mỗi dạng ở FR-025, FR-027.
  - `frontend/lib/exam-room/`: `strings-en.mjs`, `strings-vi.mjs`,
    `navigator-model.mjs`, `split-ratio.mjs`, `submit-guard.mjs`,
    `connection-state.mjs`, `tab-guard.mjs`, `flags.mjs`.
- Bọc `FocusShell` của `frontend/components/ui/shell/focus-shell.tsx` (UIBASE-0056
  FR-009, FR-025): thanh trên, nút thoát và `LeaveConfirm`, nút "Abandon test",
  quy tắc luôn sáng, `registerNavigationGuard`, `FocusTimer`, `FocusStatus`. Không
  tạo `exit-dialog.tsx` hay `exam-timer.tsx` riêng; nếu `FocusShell` thiếu một
  điểm móc (ví dụ nút nộp ở khe `bottom` cần biết trạng thái hộp thoát), PR T03 thêm
  prop nhỏ vào `FocusShell` mà không đổi hành vi đã duyệt và ghi trong PR.
- Dựng trên component G03 đã có trong `frontend/components/ui/` (`button`,
  `dialog`, `confirm-dialog`, `notice`, `tabs`, `choice-group`, `select`,
  `text-field`) và `frontend/lib/use-dialog-focus.ts`. Không tạo bản sao nút hay
  hộp thoại riêng.
- `frontend/tooling/generate-runtime-config.mjs` thêm trường `examRoomSurfaces`
  (phương án A của câu hỏi mở 1). Tên hợp lệ là đúng các giá trị `ExamRoomSurface`, gồm
  `listening-practice` (sửa đổi 1 mục (b)); `EXAM_ROOM_SURFACES` trong `flags.mjs` là
  danh sách duy nhất. `frontend/public/js/runtime-config.js` commit ở
  bản chưa cấu hình.
- Không sửa `core-player-affinity.mjs`, `components/authed-shell.tsx`, layout hay
  `pageStylesheets` của trình nào, `frontend/pages/*.html`,
  `frontend/public/js/*.js`.
- Không route mới. Không đổi backend.

## Data and contracts

Props của `ExamRoomShell` (hợp đồng giữa khung và trình, theo GOI-08 mục 5.2):

```ts
type ExamRoomMode = 'test' | 'practice';
type ExamRoomSurface = 'reading' | 'listening' | 'listening-practice' | 'mock' | 'writing' | 'speaking' | 'drill';
// 'listening-practice' (sửa đổi 1 mục (b)): Listening luyện, chế độ practice; 'listening' giữ cho full test, mini test, drill.
interface ExamRoomSection { id: string; kind: 'passage' | 'part' | 'task'; index: number; firstQ: number; lastQ: number }
interface ExamRoomQuestion { q: number; sectionId: string; answered: boolean; flagged: boolean; saveState?: 'pending' | 'retrying' | 'failed' }
type ExamRoomSaveStatus =
  | { state: 'idle' } | { state: 'saving'; lastSavedAt?: Date }
  | { state: 'saved'; lastSavedAt: Date } | { state: 'retrying'; lastSavedAt?: Date; unsaved: number }
  | { state: 'failed'; lastSavedAt?: Date; unsaved: number; onRetry(): void };
interface ExamRoomShellProps {
  mode: ExamRoomMode;
  surface: ExamRoomSurface;
  embedded?: boolean;
  isFullTest?: boolean;
  attemptKey: string;
  title: string; subtitle?: string;
  timer?: { kind: 'countdown'; remainingSeconds: number; onExpire(): void }
        | { kind: 'elapsed'; elapsedSeconds: number; maxSeconds?: number } | null;
  saveStatus: ExamRoomSaveStatus;
  sections?: ExamRoomSection[]; questions?: ExamRoomQuestion[]; currentQ?: number;
  onJump?(q: number): void; onToggleFlag?(q: number): void; flagsReady?: boolean;
  layout: { kind: 'split'; left: ReactNode; right: ReactNode; leftLabel: string; rightLabel: string }
        | { kind: 'single'; body: ReactNode };
  submit?: { label: string; onSubmit(): Promise<void>; disabledReason?: string; costNote?: string;
             extraWarning?: ReactNode;
             outcome?: 'idle' | 'submitting' | 'confirmed' | 'unconfirmed' | 'unconfirmed_manual' | 'closed_unconfirmed' | 'expired_unsubmitted';
             savedUpTo?: string; closedAt?: string; onRetry?: () => void };   // FR-034: only the surface sets 'confirmed', after a canonical server ack
  exit: { href: string; flush(): Promise<{ unsaved: number }>; losesWork(): boolean;
          abandon?: { onAbandon(): Promise<void> } };
  ownerKey: string;                   // account id, or the share-link guest scope (FR-035)
  onSessionExpired?: { saveLocalCopy(): boolean; returnUrl: string };   // true when the copy was written and read back
  onSessionConflict?(kind: 'displaced' | 'not_current'): void;
  timeUpChoice?: { onSend(): Promise<void>; onDiscard(): Promise<void>; costNote?: string };
}
```

- Shell **không** gọi API. Mỗi trình giữ nguyên hàm lưu/nộp hiện có và đưa vào qua
  props; đây là cách giữ hợp đồng backend.
- `submit.onSubmit` chỉ được gọi từ nút xác nhận trong hộp nộp hoặc từ
  `timer.onExpire`. Shell khoá nút trong lúc `onSubmit` chạy.
- Dạng câu nhận `mode`, `strings`, `value`, `onChange`, `disabled`, `result?`;
  `value` là chuỗi giống hệt `user_answer` trình đang gửi.
- `audio-player.tsx` nhận `policy: 'practice' | 'test' | 'once'`,
  `onPlaybackStart?`, `resumeAt?`, và chỉ ánh xạ sang `AudioPlayer` của G03 (#2492):
  `practice` → `mode='practice'` + `spaceToggles`; `test` → `mode='exam'`; `once` →
  `variant='once'`. Chuỗi tiếng Anh cho `test` qua prop `copy` (câu hỏi mở 9).
- Bộ chuỗi tối thiểu theo GOI-08 mục 5.3; câu chữ của tờ thiết kế là chuẩn. Không
  chuỗi nào chứa mã lỗi HTTP, tên tham số hay `attempt_id`.
- Cờ: `examRoomEnabled(surface)` là hàm duy nhất đọc cờ; mỗi trình rẽ nhánh đúng
  một chỗ ở component gốc. Giá trị mặc định rỗng.
- Lưu tại trình duyệt: FR-032. Log: FR-033, qua endpoint hiện có, không đổi backend.
- OpenAPI không đổi (phương án A). Nếu anh chọn B, PR backend riêng thêm
  `exam_room_surfaces` vào `GET /auth/me` và sinh lại `frontend/types/api.d.ts`.

## UI and interaction

- Bảng trạng thái ở `ui-states.md`.
- CSS module dùng token `--av2-` của G03, gốc `[data-exam-room]`; full test đặt
  `data-theme="light"` trên gốc phòng thi.
- Bàn phím: tay nắm (mũi tên, Home, End, Enter), dải câu (Tab, Enter), hộp thoại
  (bẫy tiêu điểm, Esc khi không đang nộp), phím cách cho audio chỉ ở `practice`.
- Giảm chuyển động: dải trượt và bảng Review không có hiệu ứng khi
  `prefers-reduced-motion`.
- Bề rộng: 1280, 1024–1279, dưới 1024 (gồm 768), dưới 900 (chuyển thẻ), 390.

## Dependencies outside this spec

- `ExamEntryGate` (PHONEGATE-0081, chưa có): FR-024 dự phòng.
- Component đăng nhập G05-T19 và màn 8a–8c G05-T20 (ENROLL-0060, nháp ở #2463): FR-015,
  FR-016 dùng phương án dự phòng (`/login?next=` cùng tab; thông báo thiết bị khác) cho tới
  khi chúng lên `staging`. Khi chúng lên, một PR nhỏ đổi hộp sang component thật; không
  chặn T001–T004.

## Work decomposition

1. G08-T02: logic thuần `frontend/lib/exam-room/*.mjs`, trường `examRoomSurfaces`,
   test `frontend/tests/exam-room-*.test.mjs`. Không trình nào dùng.
2. G08-T03: `ExamRoomShell` và thành phần con, test
   `frontend/tests/react/exam-room-*.test.tsx`. Phụ thuộc T02.
3. G08-T04: dạng câu dùng chung. Phụ thuộc T03.
4. G08-T05: `audio-player.tsx`, `annotation-layer.tsx`. Phụ thuộc T03. T04 và T05
   khác file nên làm song song được.

## Rollout and rollback

Xem `rollout.md`. Không có gì bật ở production trong bốn PR này: khung chỉ được
dùng khi một spec trình (0067–0073) lắp nó và cờ của trình đó bật.

## Verification strategy

- `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/exam-room-*.test.mjs`:
  40 câu 13/13/14, Listening 10×4, đề 3 Passage không đều, câu hiện tại ở phần
  cuối, phần gọn có cờ; tỉ lệ 80 → 70, cửa sổ 700px → chế độ thẻ;
  `examRoomEnabled` trả false khi cấu hình null; ghi đè bị bỏ ở production.
- `npm --prefix frontend run test:react`: kéo tay nắm (pointer giả), phím, bấm đúp;
  dải câu ở 1280/1100/768/390; bốn trạng thái ô và nhãn đọc; hộp nộp có/không câu
  trống, Esc, tiêu điểm; hộp thoát flush xong mới điều hướng; dải mất mạng; hộp
  401; thông báo tab khác; đồng hồ mốc 5 phút và 0; A–B; `test` không tua/tốc độ;
  `once` không có nút tạm dừng hay phím tắt khi đang phát, không tua, không phát lại (FR-029).
- Dạng câu: chuỗi đáp án sinh ra trùng chuỗi trình hiện tại sinh với fixture
  `frontend/tooling/write-flows/fixtures/reading-exam.json` (so hai hàm, không so mã
  nguồn).
- `cd frontend && npx tsc --noEmit && npm run build`; bộ hợp đồng frontend đầy đủ.
- Ảnh 1280px và 390px từ trang thử chỉ có trong test, đối chiếu tờ `PhongThi`.
