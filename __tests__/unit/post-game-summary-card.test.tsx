import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PostGameSummaryCard from '@/components/PostGameSummaryCard';

const card = (reflections: Record<string, string>) => renderToStaticMarkup(
  <PostGameSummaryCard entry={{
    id: 1, gameId: 'g1', timestamp: '2026-01-14T21:01:00.000Z',
    postGameSummary: { statistics: null, reflections },
    gameSnapshot: { opponent: 'pacaumarti', result: 'win', date: '2026-01-14', white: 'pacaumarti', black: 'romank66' },
  }} />,
);
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('PostGameSummaryCard — free text', () => {
  it('shows a summary’s free text, with no heading of its own', () => {
    const html = card({ overall: 'This was a solid game.' });
    expect(html).toContain('data-summary-overall');
    expect(textOf(html)).toContain('This was a solid game.');
    expect(textOf(html)).not.toContain('No reflections written yet');
  });

  it('puts it ahead of the headed sections', () => {
    const text = textOf(card({ overall: 'This was a solid game.', lessonsLearned: 'Evaluate, don’t just calculate' }));
    expect(text.indexOf('This was a solid game.')).toBeLessThan(text.indexOf('Lessons Learned'));
  });

  it('still says when nothing has been written', () => {
    expect(textOf(card({}))).toContain('No reflections written yet');
  });
});
