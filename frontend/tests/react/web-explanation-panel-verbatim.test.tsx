import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WebExplanationPanel } from '@/components/web-explanation-panel';

afterEach(() => { cleanup(); });

// Excerpts of the staging payloads named in CQA-F08 (content QA 27/10).
const C18_T1_Q24 = {
  object_id: 'cambridge-18-test-1-listening-q24',
  explanation: {
    answer_summary: 'Đáp án chuẩn: C.',
    script_extract: "```\nHUGO: Well, we had numerous talks on careers, which was good, but none of them were (Q24)\nvery inspiring. They could have asked more people like today's speaker to talk to us.\n```",
    source_evidence: [{
      quote: "HUGO: Well, we had numerous talks on careers, which was good, but none of them were (Q24) very inspiring. They could have asked more people like today's speaker to talk to us.",
      location: 'Section 3; cambridge_ielts_18_test_1_audioscript.md',
      relation: 'Transcript evidence (token containment 1.000).',
      timestamp: '988.05-995.48s',
    }],
  },
};

const C20_T4_Q10 = {
  object_id: 'cambridge-20-test-4-listening-q10',
  explanation: {
    answer_summary: 'Đáp án chuẩn: tower.',
    script_extract: "```\nSpeaker 2 (Sandra): And if you're in Blakewell Gardens, climb Telegraph Hill.\n```",
    source_evidence: [{ quote: 'Speaker 1 (Man): Where\'s that near?', location: 'Section 1' }],
    why_other_answers_fail: '**Re-listen anchor:** Part 1, Speaker 2 (Sandra) — đoạn Blakewell Gardens. '
      + '**Drill 1 — tên đánh vần từng chữ cái (Q1)** · ~16 giây > Speaker 2 (Sandra): Yes, I do. '
      + 'Actually, I always recommend people stay at the ______ Hotel. > Speaker 1 (Man): Where\'s that near?',
  },
};

function renderPanel(object: unknown) {
  return render(<WebExplanationPanel object={object} skill="listening" attemptId={null} questionNumber={1}
    persistenceEnabled={false} correctionRequired={false} />);
}

it('renders the C18 T1 Q24 transcript extract and source quote with "speaker" verbatim', () => {
  const { container } = renderPanel(C18_T1_Q24);
  const sentence = "They could have asked more people like today's speaker to talk to us.";
  expect(container.querySelector('.wex-script')?.textContent).toContain(sentence);
  expect(container.querySelector('.wex-evidence blockquote')?.textContent).toContain(sentence);
  expect(container.textContent).not.toContain('người nói');
});

it('keeps "Speaker 1/2" transcript tags verbatim while localising the Vietnamese anchor label', () => {
  const { container } = renderPanel(C20_T4_Q10);
  expect(container.querySelector('.wex-script')?.textContent).toContain('Speaker 2 (Sandra): And if you\'re in Blakewell Gardens');
  expect(container.querySelector('.wex-evidence blockquote')?.textContent).toBe('Speaker 1 (Man): Where\'s that near?');
  const text = container.textContent || '';
  expect(text).toContain('> Speaker 2 (Sandra): Yes, I do.');
  expect(text).toContain('> Speaker 1 (Man): Where\'s that near?');
  expect(text).not.toMatch(/người nói [12] \((?:Sandra|Man)\):/);
  // The other clean() rewrites still run on the Vietnamese explanation.
  expect(text).toContain('Mốc nghe lại:');
  expect(text).toContain('Part 1, người nói 2 (Sandra) — đoạn Blakewell Gardens.');
});
