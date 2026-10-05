import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ListeningSourceBlock } from '@/components/listening-source-block';
import type { ListeningSourceBlockWire } from '@/lib/listening-source-collection-api';

const content = JSON.parse(readFileSync('../backend/content/listening/80-days-native-v1.json', 'utf8'));
const bindings = JSON.parse(readFileSync('../backend/tests/fixtures/listening_source_round1/native-presentation-bindings.json', 'utf8')).blocks;
function block(id: string): ListeningSourceBlockWire { return { ...bindings[id], images: [{ asset_id: 'archival-crop', url: '/NEVER_DISPLAY_PDF.png', width: 100, height: 100, alt_vi: 'Never display' }], native: content.blocks[id].presentation }; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('renders every source block as native text, rows and passive SVG without a PDF crop', () => {
  let questionCount = 0; let figures = 0;
  for (const [id, value] of Object.entries(content.blocks)) {
    const native = (value as { presentation: ListeningSourceBlockWire['native'] }).presentation!;
    const view = render(<ListeningSourceBlock block={{ block_id: id, part_id: id, kind: 'native', instruction: {}, item_ids: [], source_question_numbers: [], shared_options: [], description: '', display_kind: 'practice', study_available: false, images: [{ asset_id: 'archival', url: '/NEVER_DISPLAY_PDF.png', width: 100, height: 100, alt_vi: 'Archival crop', expires_in: 7200 }], native }} />);
    expect(view.container.querySelectorAll('.source-native__questions>li')).toHaveLength(native.questions?.length || 0);
    expect(view.container.querySelectorAll('tbody>tr')).toHaveLength(native.rows?.length || 0);
    for (const image of view.container.querySelectorAll('img')) expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    questionCount += native.questions?.length || 0; figures += native.figures?.length || 0;
    view.unmount();
  }
  expect(questionCount).toBe(1676); expect(figures).toBe(32);
});

it('keeps all10 Festival rows, fixed source values and separate blank numbers in a native table', () => {
  const view = render(<ListeningSourceBlock block={block('80-days:day-55:table_completion:block-1')} />);
  expect(screen.getByRole('columnheader', { name: 'Stage' })).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'Time' })).toBeTruthy();
  expect(view.container.querySelectorAll('tbody tr')).toHaveLength(10);
  expect(screen.getByRole('cell', { name: 'Claude and Jacques' })).toBeTruthy();
  expect(screen.getByRole('cell', { name: '(6) ____' })).toBeTruthy();
  expect(view.container.querySelectorAll('.source-native__questions>li')).toHaveLength(6);
  expect(view.container.querySelectorAll('input,textarea')).toHaveLength(0);
});

it('keeps authored map geometry and keyboard zoom while rendering SVG in an image context', () => {
  const id = '80-days:day-35:part-2:block-1';
  const view = render(<ListeningSourceBlock block={block(id)} />);
  const svg = content.blocks[id].presentation.figures[0].svg;
  const image = view.container.querySelector('img')!;
  expect(decodeURIComponent(image.getAttribute('src')!.split(',').slice(1).join(','))).toBe(svg);
  expect(image.getAttribute('width')).toBe(String(content.blocks[id].presentation.figures[0].width));
  const showModal = vi.fn();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: showModal, configurable: true });
  fireEvent.click(screen.getByRole('button', { name: 'Phóng to ảnh đề' }));
  expect(showModal).toHaveBeenCalled();
  delete (HTMLDialogElement.prototype as unknown as { showModal?: unknown }).showModal;
  expect(screen.getByRole('slider', { hidden: true }).getAttribute('max')).toBe('250');
  expect(view.container.querySelector('svg')).toBeNull();
});

it('avoids repeated question content in the persisted player and reports missing native data without a crop', () => {
  const source = block('80-days:day-55:table_completion:block-1');
  const view = render(<ListeningSourceBlock block={source} showQuestions={false} />);
  expect(screen.getByRole('table')).toBeTruthy();
  expect(view.container.querySelector('.source-native__questions')).toBeNull();
  view.rerender(<ListeningSourceBlock block={{ ...source, native: null }} />);
  expect(screen.getByRole('alert').textContent).toContain('Chưa có bản trình bày chữ và hình');
  expect(view.container.querySelector('img')).toBeNull();
});
