import { describe, it, expect, vi } from 'vitest';
import { playerColorFromSnapshot, refreshSummaryAccuracy } from '@/lib/summary-accuracy';

// ─── which side the author played ─────────────────────────────────────────────

describe('playerColorFromSnapshot', () => {
  it('is black when the opponent had white', () => {
    expect(playerColorFromSnapshot({ opponent: 'rival', white: 'rival', black: 'me' })).toBe('black');
  });

  it('is white when the opponent had black', () => {
    expect(playerColorFromSnapshot({ opponent: 'rival', white: 'me', black: 'rival' })).toBe('white');
  });

  it('ignores case and surrounding spaces in the names', () => {
    expect(playerColorFromSnapshot({ opponent: ' Rival ', white: 'RIVAL', black: 'me' })).toBe('black');
    expect(playerColorFromSnapshot({ opponent: 'rival', white: 'me', black: ' Rival' })).toBe('white');
  });

  it.each([
    ['no snapshot', null],
    ['an undefined snapshot', undefined],
    ['an empty snapshot', {}],
    ['no opponent', { white: 'a', black: 'b' }],
    ['a blank opponent', { opponent: '  ', white: 'a', black: 'b' }],
    ['an opponent who is neither player', { opponent: 'c', white: 'a', black: 'b' }],
    ['the same name on both sides', { opponent: 'a', white: 'a', black: 'a' }],
    ['names that are not text', { opponent: 5, white: 5, black: 6 }],
  ])('is null for %s, rather than guessing', (_name, snapshot) => {
    expect(playerColorFromSnapshot(snapshot)).toBeNull();
  });
});

// ─── refreshing saved summaries ───────────────────────────────────────────────

describe('refreshSummaryAccuracy', () => {
  const snapshot = { opponent: 'rival', white: 'rival', black: 'me' }; // the author had black
  const summary = (id: number, over: object = {}) => ({
    id,
    gameId: 'g1',
    entryType: 'post_game_summary',
    gameSnapshot: snapshot,
    postGameSummary: {
      statistics: { totalMoves: 30, accuracy: 98.8, blunders: 0, mistakes: 1, inaccuracies: 2, averageCentipawnLoss: 21 },
      reflections: { whatWentWell: 'x' },
    },
    ...over,
  });
  const analyses = (map: Record<string, object | null> = { g1: { whiteAccuracy: 91.2, blackAccuracy: 84.6 } }) =>
    vi.fn(async (id: string) => (map[id] ?? null) as { whiteAccuracy?: unknown; blackAccuracy?: unknown } | null);
  const accuracyOf = (e: { postGameSummary?: { statistics?: Record<string, unknown> | null } | null }) =>
    e.postGameSummary?.statistics?.accuracy;

  it('replaces the saved accuracy with the analysis’s current one for the author’s side', async () => {
    const [out] = await refreshSummaryAccuracy([summary(1)], analyses());
    expect(accuracyOf(out)).toBe(84.6); // black
  });

  it('uses White’s figure when the author had white', async () => {
    const white = summary(1, { gameSnapshot: { opponent: 'rival', white: 'me', black: 'rival' } });
    const [out] = await refreshSummaryAccuracy([white], analyses());
    expect(accuracyOf(out)).toBe(91.2);
  });

  it('corrects a summary that had saved the opponent’s accuracy', async () => {
    // saved 91.2, which is the analysis's figure for White, the opponent
    const wrong = summary(1, { postGameSummary: { statistics: { accuracy: 91.2, totalMoves: 30 } } });
    const [out] = await refreshSummaryAccuracy([wrong], analyses());
    expect(accuracyOf(out)).toBe(84.6);
  });

  it('keeps every other statistic and the rest of the summary exactly as saved', async () => {
    const [out] = await refreshSummaryAccuracy([summary(1)], analyses());

    expect(out.postGameSummary.statistics).toEqual({
      totalMoves: 30, accuracy: 84.6, blunders: 0, mistakes: 1, inaccuracies: 2, averageCentipawnLoss: 21,
    });
    expect(out.postGameSummary.reflections).toEqual({ whatWentWell: 'x' });
    expect(out).toMatchObject({ id: 1, gameId: 'g1', entryType: 'post_game_summary', gameSnapshot: snapshot });
  });

  it('does not change the entries it was given', async () => {
    const original = summary(1);
    const copy = JSON.parse(JSON.stringify(original));
    const [out] = await refreshSummaryAccuracy([original], analyses());

    expect(original).toEqual(copy);
    expect(out).not.toBe(original);
    expect(original.postGameSummary.statistics.accuracy).toBe(98.8);
  });

  it.each([
    ['a summary saved with no accuracy', summary(1, { postGameSummary: { statistics: { totalMoves: 30, accuracy: null } } })],
    ['a summary saved with no statistics', summary(1, { postGameSummary: { statistics: null } })],
    ['an entry that is not a summary', summary(1, { entryType: 'move' })],
    ['an entry with no game', summary(1, { gameId: null })],
  ])('does not touch %s', async (_name, entry) => {
    const load = analyses();
    const [out] = await refreshSummaryAccuracy([entry], load);

    expect(out).toBe(entry);
    expect(load).not.toHaveBeenCalled();
  });

  it('does not add an accuracy to a summary that had none', async () => {
    const [out] = await refreshSummaryAccuracy(
      [summary(1, { postGameSummary: { statistics: { totalMoves: 30, accuracy: null } } })],
      analyses(),
    );
    expect(accuracyOf(out)).toBeNull();
  });

  it('keeps what a summary has when the author’s side cannot be told', async () => {
    const noSide = summary(1, { gameSnapshot: { opponent: 'someone else', white: 'a', black: 'b' } });
    const [out] = await refreshSummaryAccuracy([noSide], analyses());
    expect(out).toBe(noSide);
    expect(accuracyOf(out)).toBe(98.8);
  });

  it('keeps what a summary has when the game has no analysis', async () => {
    const entry = summary(1);
    const [out] = await refreshSummaryAccuracy([entry], analyses({ g1: null }));
    expect(out).toBe(entry);
  });

  it.each([[undefined], [null], ['n/a'], [NaN], [Infinity]])('keeps what a summary has when the analysis’s figure is %s', async value => {
    const entry = summary(1);
    const [out] = await refreshSummaryAccuracy([entry], analyses({ g1: { whiteAccuracy: value, blackAccuracy: value } }));
    expect(out).toBe(entry);
  });

  it('accepts an accuracy of 0 from the analysis', async () => {
    const [out] = await refreshSummaryAccuracy([summary(1)], analyses({ g1: { whiteAccuracy: 50, blackAccuracy: 0 } }));
    expect(accuracyOf(out)).toBe(0);
  });

  it('loads each game once, however many of its summaries there are', async () => {
    const load = analyses();
    const out = await refreshSummaryAccuracy([summary(1), summary(2), summary(3)], load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(out.map(accuracyOf)).toEqual([84.6, 84.6, 84.6]);
  });

  it('loads each of several games', async () => {
    const load = analyses({ g1: { whiteAccuracy: 90, blackAccuracy: 80 }, g2: { whiteAccuracy: 70, blackAccuracy: 60 } });
    const out = await refreshSummaryAccuracy([summary(1), summary(2, { gameId: 'g2' })], load);

    expect(load).toHaveBeenCalledTimes(2);
    expect(out.map(accuracyOf)).toEqual([80, 60]);
  });

  it('returns the list itself when nothing needed refreshing', async () => {
    const list = [summary(1, { entryType: 'move' })];
    expect(await refreshSummaryAccuracy(list, analyses())).toBe(list);
  });

  it('keeps the order of the entries', async () => {
    const out = await refreshSummaryAccuracy([summary(3), summary(1), summary(2)], analyses());
    expect(out.map(e => e.id)).toEqual([3, 1, 2]);
  });

  it('survives a game that cannot be loaded, still refreshing the others', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn(async (id: string) => {
      if (id === 'bad') throw new Error('redis went away');
      return { whiteAccuracy: 90, blackAccuracy: 80 };
    });
    const broken = summary(1, { gameId: 'bad' });
    const out = await refreshSummaryAccuracy([broken, summary(2)], load);

    expect(out[0]).toBe(broken);
    expect(accuracyOf(out[1])).toBe(80);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('works for a mix of everything at once', async () => {
    const out = await refreshSummaryAccuracy(
      [
        summary(1),                                                        // refreshed
        summary(2, { entryType: 'move' }),                                 // not a summary
        summary(3, { postGameSummary: { statistics: { accuracy: null } } }), // no accuracy
        summary(4, { gameId: 'missing' }),                                 // no analysis
        summary(5, { gameSnapshot: null }),                                // side unknown
      ],
      analyses(),
    );

    expect(out.map(accuracyOf)).toEqual([84.6, 98.8, null, 98.8, 98.8]);
  });
});
