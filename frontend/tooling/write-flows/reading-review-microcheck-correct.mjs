// Cùng micro-check, bấm ĐÚNG đáp án.
//
// Đi thành cặp với bản khai chị em (bấm SAI). Một mình bản kia không đủ: một bản
// mã ghi cứng `correct: false` vẫn qua nó. Hai bản khai cộng lại ghim rằng giá
// trị THEO ĐÚNG nút vừa bấm — và đó là toàn bộ giá trị của đường ghi này, vì
// `correct` ghi ngược làm lệch hồ sơ thành thạo mà không màn hình nào tố cáo.
import base from './reading-review-microcheck.mjs';

export default {
  ...base,
  name: 'reading-review — trả lời micro-check ĐÚNG',
  steps: [
    { wait: 900 },
    { click: '.rr-card__top' },
    { wait: 300 },
    { expectVisible: '[data-mc]' },
    // Đáp án là B (`microcheck.answer`), nên bấm B là ĐÚNG.
    { click: '[data-mc] [data-letter="B"]' },
    { wait: 400 },
  ],
  writes: [{
    ...base.writes[0],
    body: (b) => b && Array.isArray(b.answers) && b.answers.length === 1
      && b.answers[0].correct === true
      && b.answers[0].kp && b.answers[0].kp.slug === 'thi-hien-tai-don',
  }],
};
