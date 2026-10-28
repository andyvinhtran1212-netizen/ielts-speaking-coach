// Lời chào + mã học viên cho Writing Dashboard.
//
// VÌ SAO — vỏ shell in TĨNH "Chào em," rồi một <span id="greeting-name"> mà
// chữ giữ chỗ/ fallback của chính nó CŨNG là "em", nên khi không có tên, lời
// chào đọc thành "Chào em, em" (lặp). Ở đây tách phần động: khi CÓ tên tài
// khoản/roster thì trả về dấu phẩy + tên ("Chào em, Vinh Tran 👋"); khi KHÔNG
// có tên thì KHÔNG dấu phẩy, KHÔNG tên — để "Chào em 👋" là một "em" duy nhất.
// UIA-1028-06: phần tĩnh nay là "Chào bạn" (cả site xưng "bạn"), nên lời chào
// đọc "Chào bạn, <tên> 👋" hoặc "Chào bạn 👋".
//
// Nguồn tên: backend `_dashboard_student` đã ưu tiên tên tài khoản (JWT) rồi
// mới tới `full_name` của roster; mã học viên là mã roster liên kết. Lớp này
// chỉ quyết định cách HIỂN THỊ, không chọn nguồn.

/**
 * @param {{full_name?: unknown} | null | undefined} student
 * @returns {{separator: string, name: string}}
 */
export function writingGreetingParts(student) {
  const raw = student && typeof student.full_name === 'string' ? student.full_name.trim() : '';
  return raw ? { separator: ', ', name: raw } : { separator: '', name: '' };
}

/**
 * @param {{student_code?: unknown} | null | undefined} student
 * @returns {string} mã học viên, hoặc "—" khi trống.
 */
export function writingStudentCode(student) {
  const code = student && student.student_code;
  return typeof code === 'string' && code.trim() ? code.trim() : '—';
}
