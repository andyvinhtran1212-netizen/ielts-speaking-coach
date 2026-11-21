# UI state matrix

UI impact: N/A — spec chỉ đổi nơi lưu và cách phục vụ file media dưới `/assets/advanced-vocab/**`. URL, response API và màn hình Advanced Vocabulary giữ nguyên, nên không màn hình hay trạng thái giao diện nào đổi. Bằng chứng không có thay đổi gồm: `curl` `Range` → 206 và so SHA-256 (FR-003), cùng bài thử trên staging (Scenario 1, gói E2E-5).
