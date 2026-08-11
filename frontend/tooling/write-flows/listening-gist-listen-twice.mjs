// Cùng trang, nhánh KHÁC: nghe HAI lần rồi mới nộp. Xem `listening-tf-listen-twice.mjs`
// để biết vì sao nhánh này phải có bản khai riêng và vì sao phải phát `play` lên
// `<audio>` bên trong component thay vì phát thẳng `av-audio-play` lên host.
import base from './listening-gist-submit.mjs';

export default {
  ...base,
  name: 'listening-gist — nghe hai lần rồi nộp',
  steps: [
    { wait: 600 },
    { dispatch: ['#player', 'play', '_audio'] },
    { wait: 150 },
    { dispatch: ['#player', 'play', '_audio'] },
    { wait: 150 },
    ...base.steps.slice(1),
  ],
  writes: [{
    ...base.writes[0],
    body: { ...base.writes[0].body, listen_count: 2 },
  }],
};
