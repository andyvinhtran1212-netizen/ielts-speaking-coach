// Bộ lọc hai trục của tab "Mẹo viết" (task × loại nội dung).
//
// W-09: mẹo gắn task_type 'both' ("Cả hai") áp dụng cho CẢ Task 1 và Task 2,
// nên phải hiện khi lọc Task 1 hoặc Task 2 (Leader chốt). Chip "Cả hai" vẫn
// chỉ hiện mẹo 'both'. Cùng quy tắc với gợi ý mẹo ở trang kết quả
// (`selectWritingTips` trong writing-result-model.mjs).

/**
 * @param {{task_type?: unknown, content_type?: unknown} | null | undefined} tip
 * @param {string} taskFilter 'all' | 'task_1' | 'task_2' | 'both'
 * @param {string} typeFilter 'all' | 'tip' | 'knowledge' | 'sample' | 'outline'
 * @returns {boolean}
 */
export function writingTipMatchesFilters(tip, taskFilter, typeFilter) {
  if (!tip) return false;
  const taskOk = taskFilter === 'all' || tip.task_type === taskFilter
    || (tip.task_type === 'both' && (taskFilter === 'task_1' || taskFilter === 'task_2'));
  const typeOk = typeFilter === 'all' || (tip.content_type || 'tip') === typeFilter;
  return taskOk && typeOk;
}
