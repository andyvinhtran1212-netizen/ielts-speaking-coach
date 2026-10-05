import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ListeningSourceExplanation } from '@/components/listening-source-explanation';
import type { ListeningSourceExplanationWire } from '@/lib/listening-source-collection-api';
import originals from '../../../backend/tests/fixtures/listening_source_editorial_unresolved.json';
import revision from '../../../backend/content/listening/80-days-explanations-v2.json';

afterEach(cleanup);

it('renders the reviewed next step and retained limitation for all 43 unresolved source-study items', () => {
  const changes = revision.items as Record<string, { changes: Partial<ListeningSourceExplanationWire> }>;
  render(<>{originals.map((item) => {
    const explanation = { ...item.explanation, ...changes[item.item_id].changes } as ListeningSourceExplanationWire;
    return <article key={item.item_id} data-testid={item.item_id}>
      <ListeningSourceExplanation explanation={explanation} reviewStatus="UNRESOLVED" provenance="source_study" />
    </article>;
  })}</>);
  expect(originals).toHaveLength(43);
  for (const item of originals) {
    const article = screen.getByTestId(item.item_id);
    const action = changes[item.item_id].changes.next_action_vi;
    expect(action).toBeTruthy();
    expect(within(article).getByText(action!)).toBeTruthy();
    expect(within(article).getByText('Chưa đủ dữ kiện')).toBeTruthy();
    expect(within(article).getByRole('note').textContent).toBe(item.explanation.source_answer_warning_vi);
    for (const evidence of item.explanation.evidence) {
      expect(article.textContent).toContain(evidence.quote);
    }
    expect(article.textContent).not.toContain(item.explanation.next_action_vi);
  }
});
