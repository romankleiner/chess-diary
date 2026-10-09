import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PostGameSummaryForm from '@/components/PostGameSummaryForm';
import { isGameOver } from '@/lib/game-status';

const snapshot = (result: string | null) => ({
  opponent: 'opponent_a', result, date: '2026-09-01', white: 'romank66', black: 'opponent_a',
});

const render = (result: string | null) => renderToStaticMarkup(
  <PostGameSummaryForm
    gameId="game-1"
    gameSnapshot={snapshot(result)}
    statistics={null}
    onSaved={() => {}}
    onCancel={() => {}}
  />,
);

const NOTE = 'Saving also shares this game’s blog and lists it in your directory.';

describe('PostGameSummaryForm — sharing the blog', () => {
  it('says before saving that a finished game’s blog will be shared', () => {
    expect(render('win')).toContain(NOTE);
  });

  it.each([null, '', 'null', 'in_progress'])('says nothing of sharing for a game still being played (%s), which is never shared', result => {
    expect(render(result)).not.toContain(NOTE);
  });
});

describe('isGameOver', () => {
  it.each(['win', 'loss', 'draw', '1-0', '0-1', '1/2-1/2'])('a game with a result (%s) is over', result => {
    expect(isGameOver(result)).toBe(true);
  });

  it.each([null, undefined, '', 'null', 'in_progress', 'in progress', 42])('a game without one (%s) is still being played', result => {
    expect(isGameOver(result)).toBe(false);
  });
});
