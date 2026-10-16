import { describe, it, expect } from 'vitest';
import { gameFilterGroups, type FilterGame } from '@/lib/game-filter-groups';

const ME = 'romank66';
const game = (id: string, over: Partial<FilterGame> = {}): FilterGame => ({
  id, opponent: `opp_${id}`, white: ME, black: `opp_${id}`, result: 'win', date: '2026-10-14', ...over,
});
const labels = (groups: ReturnType<typeof gameFilterGroups>) =>
  groups.map(g => [g.label, g.options.map(o => o.label)]);

describe('gameFilterGroups — finished games', () => {
  it('groups them by the month they ended, newest month and game first', () => {
    const groups = gameFilterGroups([
      game('1', { date: '2026-09-03' }),
      game('2', { date: '2026-10-14' }),
      game('3', { date: '2026-09-28' }),
      game('4', { date: '2026-10-02' }),
      game('5', { date: '2025-12-31' }),
    ], ME);
    expect(groups.map(g => [g.label, g.options.map(o => o.id)])).toEqual([
      ['October 2026', ['2', '4']],
      ['September 2026', ['3', '1']],
      ['December 2025', ['5']],
    ]);
  });

  it('names each by opponent, day and result, so two games against one opponent can be told apart', () => {
    const groups = gameFilterGroups([
      game('1', { opponent: 'Late_One', date: '2026-10-14', result: 'win' }),
      game('2', { opponent: 'Late_One', date: '2026-10-03', result: 'loss' }),
      game('3', { opponent: 'Middle_One', date: '2026-10-01', result: 'draw' }),
    ], ME);
    expect(labels(groups)).toEqual([
      ['October 2026', ['vs Late_One · as White · 14 Oct · Won', 'vs Late_One · as White · 3 Oct · Lost', 'vs Middle_One · as White · 1 Oct · Draw']],
    ]);
  });

  it('tells apart a pair of games against one opponent ending the same day, by the colour I played', () => {
    const [group] = gameFilterGroups([
      game('1', { opponent: 'Pair', white: ME, black: 'Pair' }),
      game('2', { opponent: 'Pair', white: 'Pair', black: ME }),
    ], ME);
    expect(group.options.map(o => o.label).sort()).toEqual(['vs Pair · as Black · 14 Oct · Won', 'vs Pair · as White · 14 Oct · Won']);
  });

  it('reads the date as written, with no time zone to move a game to another day or month', () => {
    const [group] = gameFilterGroups([game('1', { date: '2026-10-01' })], ME);
    expect(group.label).toBe('October 2026');
    expect(group.options[0].label).toBe('vs opp_1 · as White · 1 Oct · Won');
  });

  it('keeps a game with the same day in order by id, so the list does not shuffle', () => {
    const ids = gameFilterGroups([game('100'), game('300'), game('200')], ME)[0].options.map(o => o.id);
    expect(ids).toEqual(['300', '200', '100']);
  });

  it('puts a game whose date can’t be read last, under "Date unknown"', () => {
    const groups = gameFilterGroups([game('1', { date: undefined }), game('2', { date: 'soon' }), game('3')], ME);
    expect(labels(groups)).toEqual([
      ['October 2026', ['vs opp_3 · as White · 14 Oct · Won']],
      ['Date unknown', ['vs opp_1 · as White · Won', 'vs opp_2 · as White · Won']],
    ]);
  });

  it('shows an unfamiliar result as it is stored', () => {
    expect(gameFilterGroups([game('1', { result: 'abandoned' })], ME)[0].options[0].label).toBe('vs opp_1 · as White · 14 Oct · abandoned');
  });
});

describe('gameFilterGroups — games still being played', () => {
  it('lists them first, the one whose move is due soonest at the top', () => {
    const groups = gameFilterGroups([
      game('done'),
      game('later', { result: null, move_by: 2_000 }),
      game('soon', { result: null, move_by: 1_000 }),
      game('undated', { result: null }),
    ], ME);
    expect(groups[0].label).toBe('Active games');
    expect(groups[0].options.map(o => o.id)).toEqual(['soon', 'later', 'undated']);
    expect(groups[1].label).toBe('October 2026');
  });

  it('says when it is my move, whichever colour I play', () => {
    const groups = gameFilterGroups([
      game('w', { result: null, white: ME, black: 'a', opponent: 'a', turn: 'white' }),
      game('b', { result: null, white: 'b', black: 'RomanK66', opponent: 'b', turn: 'black' }),
      game('theirs', { result: null, white: ME, black: 'c', opponent: 'c', turn: 'black' }),
    ], ME);
    expect(groups[0].options.map(o => o.label).sort()).toEqual(['vs a · as White · your move', 'vs b · as Black · your move', 'vs c · as White']);
  });

  it('says nothing of whose move it is without my username', () => {
    const groups = gameFilterGroups([game('w', { result: null, turn: 'white' })], '');
    expect(groups[0].options[0].label).toBe('vs opp_w');
  });

  it.each([null, 'null', 'in_progress'])('counts a game with result %s as still being played', result => {
    expect(gameFilterGroups([game('1', { result })], ME)[0].label).toBe('Active games');
  });
});

describe('gameFilterGroups — nothing to list', () => {
  it('has no groups for no games, and no empty groups', () => {
    expect(gameFilterGroups([], ME)).toEqual([]);
    expect(gameFilterGroups([game('1')], ME).map(g => g.label)).toEqual(['October 2026']);
    expect(gameFilterGroups([game('1', { result: null })], ME).map(g => g.label)).toEqual(['Active games']);
  });
});
