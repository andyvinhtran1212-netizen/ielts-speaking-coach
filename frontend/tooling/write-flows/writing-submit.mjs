// Luồng ghi của trang Bài viết: mở bài giao → gõ bài → dán → nộp.
//
// KHAI TRƯỚC, PORT SAU. Bản khai này được viết và làm-cho-xanh trên trang
// LEGACY trước khi có một dòng React nào (`WF_LEGACY=1`). Thứ tự đó quan trọng:
// nếu viết bản Next trước rồi mới khai, bản khai chỉ mô tả thứ tôi VỪA VIẾT, và
// một đường ghi bị bỏ sót trong lúc port sẽ bị bỏ sót y hệt trong bản khai. Khai
// từ legacy thì bản khai là hợp đồng độc lập.
//
// Trang này có bốn đường ghi và chúng KHÔNG tương đương nhau về hậu quả:
//   · `/start`     — mở lượt làm bài, khởi động đồng hồ phía server. Gọi thiếu
//                    thì bài không tính giờ; gọi thừa thì lượt bị đặt lại.
//   · `/draft`     — tự lưu sau 3 giây ngừng gõ. Mất nó là mất bài của học viên.
//   · `/paste-log` — nhật ký dán. Ngưỡng: <50 ký tự im lặng, 50–200 ghi nhật ký,
//                    >200 CHẶN rồi ghi nhật ký kèm `blocked: true`.
//   · `/submit`    — nộp bài.
//
// Bước dán ở đây cố ý dùng 60 ký tự: rơi vào khoảng GIỮA (ghi nhật ký nhưng
// không chặn). Đó là khoảng dễ hỏng nhất khi port — chặn-hay-không là một câu
// `if` mà một bản port vội rất dễ đơn giản hoá thành "cứ dán là chặn".
const ASSIGNMENT = 'asg-1';
const ESSAY = 'Bài viết kiểm cổng ghi. '.repeat(6);
const PASTED = 'Đoạn dán dài sáu mươi ký tự để rơi vào khoảng ghi-nhật-ký.';

export default {
  name: 'writing — mở bài giao, tự lưu, dán, nộp',
  route: '/writing-dashboard',
  // Trang legacy nằm ở đường khác; cùng bản khai chạy được cả hai vế.
  legacyRoute: '/pages/writing-dashboard.html',
  // GỠ DÒNG NÀY khi `/writing-dashboard` bản Next lên. Tới lúc đó, cùng bản khai
  // này phải xanh trên CẢ HAI vế — đó là định nghĩa "port xong" cho trang này.
  nextPending: 'trang Next chưa tồn tại — bản khai được dựng TRƯỚC khi port',

  canned: [
    [/\/api\/student\/permissions$/, { writing: true }],
    [/\/api\/writing\/my-assignments$/, {
      student: { display_name: 'Học Viên', student_code: 'HV-01', target_band: 6.5 },
      assignments: [{
        id: ASSIGNMENT,
        // `pending`/`in_progress` là HAI trạng thái duy nhất trang coi là đang
        // hoạt động (`ACTIVE_ASSIGNMENT_STATES`). Bản khai đầu tiên tôi viết
        // `active` — nghe hợp lý nhưng sai, và thẻ bị lọc sạch nên không bước
        // nào chạy. Chạy bản khai trên LEGACY lộ ra ngay; nếu port trước rồi
        // mới khai thì giá trị sai đã được đóng đinh vào cả hai vế.
        status: 'pending',
        name: 'Task 2 — kiểm cổng ghi',
        deadline: null,
        has_draft: false,
        draft_word_count: 0,
        is_timed: false,
        allow_soft_check: false,
        writing_prompts: {
          id: 'p1', title: 'Đề kiểm', task_type: 'task2',
          prompt_text: 'Viết một bài luận.', prompt_image_url: null,
        },
      }],
    }],
    [/\/api\/writing\/my-essays$/, { student: { display_name: 'Học Viên' }, essays: [] }],
    [/\/api\/writing\/prompt-bank$/, { enabled: false, prompts: [] }],
    [/\/api\/writing\/tips$/, { tips: [] }],
    // GET chi tiết bài giao — CHÚ Ý thứ tự: mẫu này phải đứng SAU mẫu
    // `my-assignments$` ở trên, vì bộ chạy lấy mẫu khớp ĐẦU TIÊN.
    [/\/api\/writing\/my-assignments\/[^/]+$/, {
      assignment: {
        id: ASSIGNMENT, name: 'Task 2 — kiểm cổng ghi', instructions: '',
        allow_soft_check: false,
        writing_prompts: {
          id: 'p1', title: 'Đề kiểm', task_type: 'task2',
          prompt_text: 'Viết một bài luận.', prompt_image_url: null,
        },
      },
      draft: { draft_text: '' },
      timer: { is_timed: false, time_limit_minutes: null, time_remaining_seconds: null, is_expired: false },
    }],
  ],

  steps: [
    // Bấm đúng NÚT, không phải cả thẻ: bộ nghe gắn trên `.btn-start-assignment`
    // (uỷ quyền từ danh sách), nên bấm vào thẻ không mở modal và cũng không gửi
    // `/start`. Bản khai đầu tiên của tôi bấm cả thẻ và im lặng không làm gì.
    { click: `.assignment-card[data-assignment-id="${ASSIGNMENT}"] .btn-start-assignment` },
    { wait: 400 },
    { fill: ['#modal-essay-textarea', ESSAY] },
    // Tự lưu chờ 3 giây im lặng — chờ dài hơn thế mới chắc nó đã nổ.
    { wait: 3400 },
    { paste: ['#modal-essay-textarea', PASTED] },
    { wait: 300 },
    { click: '#modal-btn-submit' },
  ],

  ignoreWrites: ['/api/analytics/events'],

  writes: [
    { method: 'POST', path: `/api/writing/my-assignments/${ASSIGNMENT}/start` },
    { method: 'PATCH', path: `/api/writing/my-assignments/${ASSIGNMENT}/draft`, body: { draft_text: ESSAY } },
    { method: 'POST', path: `/api/writing/my-assignments/${ASSIGNMENT}/paste-log`, body: { blocked: false } },
    { method: 'POST', path: `/api/writing/my-assignments/${ASSIGNMENT}/submit` },
  ],
};
