import { describe, it, expect } from 'vitest';
import {
  NO_FILTER, buildDirectoryEntry, countCommentary, describeCommentary, filterDirectory, formatDateRange, formatTimeControl,
  groupByMonth, sortDirectory, tallyResults, type DirectoryEntry,
} from '@/lib/blog-directory';

const entry = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  gameId: '100', white: 'romank66', black: 'opponent_a', whiteRating: 1523, blackRating: 1480, authorColor: 'white', opponent: 'opponent_a',
  result: 'win', inProgress: false, startDate: '2026-07-10', endDate: '2026-07-24', timeControl: '1 day per move',
  commentedMoves: 9, hasSummary: true,
  ...over,
});
const ids = (entries: readonly DirectoryEntry[]) => entries.map(e => e.gameId);

// ─── wording ──────────────────────────────────────────────────────────────────

describe('formatTimeControl', () => {
  it.each([
    ['1/86400', '1 day per move'],
    ['1/172800', '2 days per move'],
    ['1/259200', '3 days per move'],
    ['1/1209600', '14 days per move'],
    ['daily', 'Daily'],
    ['Daily', 'Daily'],
    ['  1/86400 ', '1 day per move'],
  ])('writes %s as "%s"', (raw, shown) => {
    expect(formatTimeControl(raw)).toBe(shown);
  });

  it('shows nothing for no time control', () => {
    expect(formatTimeControl('')).toBe('');
    expect(formatTimeControl('   ')).toBe('');
    expect(formatTimeControl(null)).toBe('');
    expect(formatTimeControl(undefined)).toBe('');
  });

  it('leaves anything it does not know as it came, rather than guess', () => {
    for (const raw of ['600', '180+2', '1/3600', '1/0', '2/86400', '1/129600']) expect(formatTimeControl(raw)).toBe(raw);
  });
});

describe('formatDateRange', () => {
  it('joins the start and the end', () => {
    expect(formatDateRange('2026-07-10', '2026-07-24')).toBe('2026-07-10 – 2026-07-24');
  });

  it('says a one-day game’s date once', () => {
    expect(formatDateRange('2026-07-10', '2026-07-10')).toBe('2026-07-10');
  });

  it('gives the one date that is known, or nothing', () => {
    expect(formatDateRange(null, '2026-07-24')).toBe('2026-07-24');
    expect(formatDateRange('2026-07-10', null)).toBe('2026-07-10');
    expect(formatDateRange(null, null)).toBe('');
  });
});

describe('describeCommentary', () => {
  it.each([
    [0, false, 'No move commentary'],
    [1, false, '1 commentated move'],
    [9, false, '9 commentated moves'],
    [9, true, '9 commentated moves · overall summary'],
    [1, true, '1 commentated move · overall summary'],
    [0, true, 'No move commentary · overall summary'],
  ])('%d moves, summary %s → "%s"', (commentedMoves, hasSummary, expected) => {
    expect(describeCommentary({ commentedMoves, hasSummary })).toBe(expected);
  });
});

// ─── building a row ───────────────────────────────────────────────────────────

describe('buildDirectoryEntry', () => {
  const PGN = '[Event "Daily"]\n[Date "2026.07.10"]\n[White "romank66"]\n[Black "opponent_a"]\n[WhiteElo "1523"]\n[BlackElo "1480"]\n\n1. e4 e5';
  const game = {
    white: 'romank66', black: 'opponent_a', opponent: 'opponent_a', result: 'win',
    date: '2026-07-24', pgn: PGN, timeControl: '1/86400',
  };
  const build = (over: Partial<Parameters<typeof buildDirectoryEntry>[0]> = {}) =>
    buildDirectoryEntry({ gameId: '952794945', game, username: 'romank66', commentedMoves: 9, hasSummary: true, ...over });

  it('reads the players, result, dates, time control and commentary of the game', () => {
    expect(build()).toEqual({
      gameId: '952794945', white: 'romank66', black: 'opponent_a', whiteRating: 1523, blackRating: 1480, authorColor: 'white', opponent: 'opponent_a',
      result: 'win', inProgress: false, startDate: '2026-07-10', endDate: '2026-07-24',
      timeControl: '1 day per move', commentedMoves: 9, hasSummary: true,
    });
  });

  it('tells which side the author played from their Chess.com name, ignoring case on either side', () => {
    expect(build({ username: 'ROMANK66' }).authorColor).toBe('white');
    // Chess.com keeps the capitals a player registered with
    expect(build({ game: { ...game, white: 'RomanK66' } }).authorColor).toBe('white');
    expect(build({ game: { ...game, white: 'opponent_a', black: 'RomanK66' } }).authorColor).toBe('black');
    expect(build({ game: { ...game, white: 'opponent_a', black: 'romank66' } }).authorColor).toBe('black');
    expect(build({ username: 'someone_else' }).authorColor).toBeNull();
    expect(build({ username: '' }).authorColor).toBeNull();
    expect(build({ username: null }).authorColor).toBeNull();
  });

  it('names the other player when the game does not', () => {
    const noOpponent = { ...game, opponent: '' };
    expect(build({ game: noOpponent }).opponent).toBe('opponent_a');
    expect(build({ game: { ...noOpponent, white: 'opponent_a', black: 'romank66' } }).opponent).toBe('opponent_a');
    expect(build({ game: noOpponent, username: null }).opponent).toBe('');
  });

  it('takes the result as win, draw or loss, from any capitalisation', () => {
    for (const r of ['win', 'draw', 'loss'] as const) expect(build({ game: { ...game, result: r } }).result).toBe(r);
    expect(build({ game: { ...game, result: 'Win' } }).result).toBe('win');
  });

  it('has no result for one it does not recognise, but does not call that game unfinished', () => {
    const odd = build({ game: { ...game, result: '1-0' } });
    expect(odd.result).toBeNull();
    expect(odd.inProgress).toBe(false);
    expect(odd.endDate).toBe('2026-07-24');
  });

  it('calls a game with no result in progress, with no end date, since the stored date is only when it was fetched', () => {
    const live = build({ game: { ...game, result: null } });
    expect(live.inProgress).toBe(true);
    expect(live.result).toBeNull();
    expect(live.endDate).toBeNull();
    expect(live.startDate).toBe('2026-07-10');
  });

  it('takes each player’s rating from the PGN, white’s and black’s the right way round', () => {
    const swapped = '[WhiteElo "900"]\n[BlackElo "2100"]\n\n1. e4 e5';
    expect(build({ game: { ...game, pgn: swapped } })).toMatchObject({ whiteRating: 900, blackRating: 2100 });
  });

  it('has no rating for a player whose tag is missing or unknown', () => {
    expect(build({ game: { ...game, pgn: '[WhiteElo "1523"]\n\n1. e4' } })).toMatchObject({ whiteRating: 1523, blackRating: null });
    expect(build({ game: { ...game, pgn: '[WhiteElo "?"]\n[BlackElo "?"]\n\n1. e4' } })).toMatchObject({ whiteRating: null, blackRating: null });
    expect(build({ game: { ...game, pgn: null } })).toMatchObject({ whiteRating: null, blackRating: null });
  });

  it('has no start date for a PGN that has none', () => {
    expect(build({ game: { ...game, pgn: '1. e4 e5' } }).startDate).toBeNull();
    expect(build({ game: { ...game, pgn: null } }).startDate).toBeNull();
  });

  it('copes with a game missing most of its fields', () => {
    expect(buildDirectoryEntry({ gameId: '1', game: {}, commentedMoves: 0, hasSummary: false })).toEqual({
      gameId: '1', white: '', black: '', whiteRating: null, blackRating: null, authorColor: null, opponent: '', result: null, inProgress: true,
      startDate: null, endDate: null, timeControl: '', commentedMoves: 0, hasSummary: false,
    });
  });
});

describe('countCommentary', () => {
  const journal = [
    { gameId: 'a', entryType: 'thought', content: 'one' },
    { gameId: 'a', entryType: 'thought', content: 'two' },
    { gameId: 'a', entryType: 'post_game_summary', content: 'summary' },
    { gameId: 'b', entryType: 'thought', content: 'three' },
    { gameId: 'c', entryType: 'thought', content: 'not wanted' },
  ];

  it('counts the moves written about at each wanted game, and whether it has a summary', () => {
    const counts = countCommentary(journal, new Set(['a', 'b']));
    expect(counts.get('a')).toEqual({ commentedMoves: 2, hasSummary: true });
    expect(counts.get('b')).toEqual({ commentedMoves: 1, hasSummary: false });
  });

  it('leaves out games that were not asked for', () => {
    expect(countCommentary(journal, new Set(['a'])).has('c')).toBe(false);
  });

  it('does not count an entry with nothing written in it, which the blog does not show either', () => {
    const counts = countCommentary(
      [{ gameId: 'a', entryType: 'thought', content: '' }, { gameId: 'a', entryType: 'thought', content: '  \n ' }, { gameId: 'a', entryType: 'thought' }],
      new Set(['a']),
    );
    expect(counts.get('a')).toEqual({ commentedMoves: 0, hasSummary: false });
  });

  it('counts every kind of entry but the summary as a move, as the blog does', () => {
    const counts = countCommentary(
      ['game_start', 'thought', 'move', 'note'].map(entryType => ({ gameId: 'a', entryType, content: 'x' })),
      new Set(['a']),
    );
    expect(counts.get('a')!.commentedMoves).toBe(4);
  });

  it('ignores an entry that belongs to no game', () => {
    expect(countCommentary([{ gameId: null, entryType: 'thought', content: 'x' }, { entryType: 'thought', content: 'y' }], new Set(['a'])).size).toBe(0);
  });

  it('notes a summary even when there is nothing else', () => {
    expect(countCommentary([{ gameId: 'a', entryType: 'post_game_summary', content: '' }], new Set(['a'])).get('a'))
      .toEqual({ commentedMoves: 0, hasSummary: true });
  });
});

// ─── order and grouping ───────────────────────────────────────────────────────

describe('sortDirectory', () => {
  it('puts the game that ended most recently first', () => {
    const sorted = sortDirectory([
      entry({ gameId: '1', endDate: '2026-04-19' }),
      entry({ gameId: '2', endDate: '2026-09-16' }),
      entry({ gameId: '3', endDate: '2026-06-01' }),
    ]);
    expect(ids(sorted)).toEqual(['2', '3', '1']);
  });

  it('places a game still being played by when it began', () => {
    const sorted = sortDirectory([
      entry({ gameId: '1', endDate: '2026-06-01', startDate: '2026-05-01' }),
      entry({ gameId: '2', endDate: null, startDate: '2026-07-01', inProgress: true }),
      entry({ gameId: '3', endDate: '2026-04-01', startDate: '2026-03-01' }),
    ]);
    expect(ids(sorted)).toEqual(['2', '1', '3']);
  });

  it('puts games with no date at all last', () => {
    const sorted = sortDirectory([
      entry({ gameId: 'x', startDate: null, endDate: null }),
      entry({ gameId: '1', endDate: '2026-04-19' }),
      entry({ gameId: 'y', startDate: null, endDate: null }),
    ]);
    expect(ids(sorted).slice(0, 1)).toEqual(['1']);
    expect(ids(sorted).slice(1).sort()).toEqual(['x', 'y']);
  });

  it('breaks a tie by when the game began, then by game number, newest first', () => {
    const sorted = sortDirectory([
      entry({ gameId: '9', startDate: '2026-07-01', endDate: '2026-07-24' }),
      entry({ gameId: '10', startDate: '2026-07-01', endDate: '2026-07-24' }),
      entry({ gameId: '5', startDate: '2026-07-10', endDate: '2026-07-24' }),
    ]);
    expect(ids(sorted)).toEqual(['5', '10', '9']);
  });

  it('does not change the list it was given', () => {
    const input = [entry({ gameId: '1', endDate: '2026-01-01' }), entry({ gameId: '2', endDate: '2026-02-01' })];
    sortDirectory(input);
    expect(ids(input)).toEqual(['1', '2']);
  });

  it('copes with nothing', () => {
    expect(sortDirectory([])).toEqual([]);
  });
});

describe('groupByMonth', () => {
  it('gathers entries under the month they ended in, in order', () => {
    const groups = groupByMonth([
      entry({ gameId: '1', endDate: '2026-09-16' }),
      entry({ gameId: '2', endDate: '2026-09-02' }),
      entry({ gameId: '3', endDate: '2026-07-24' }),
    ]);
    expect(groups.map(g => [g.key, g.label, ids(g.entries)])).toEqual([
      ['2026-09', 'September 2026', ['1', '2']],
      ['2026-07', 'July 2026', ['3']],
    ]);
  });

  it('names every month', () => {
    const labels = Array.from({ length: 12 }, (_, i) =>
      groupByMonth([entry({ endDate: `2026-${String(i + 1).padStart(2, '0')}-15` })])[0].label);
    expect(labels).toEqual([
      'January 2026', 'February 2026', 'March 2026', 'April 2026', 'May 2026', 'June 2026',
      'July 2026', 'August 2026', 'September 2026', 'October 2026', 'November 2026', 'December 2026',
    ]);
  });

  it('keeps months of different years apart', () => {
    const groups = groupByMonth([entry({ gameId: '1', endDate: '2026-01-05' }), entry({ gameId: '2', endDate: '2025-01-05' })]);
    expect(groups.map(g => g.label)).toEqual(['January 2026', 'January 2025']);
  });

  it('places a game still being played in the month it began', () => {
    const [group] = groupByMonth([entry({ endDate: null, startDate: '2026-08-30', inProgress: true })]);
    expect(group.label).toBe('August 2026');
  });

  it('gathers games with no usable date under "Undated", last', () => {
    const groups = groupByMonth([
      entry({ gameId: 'u1', startDate: null, endDate: null }),
      entry({ gameId: '1', endDate: '2026-04-19' }),
      entry({ gameId: 'u2', startDate: null, endDate: 'garbage' }),
      entry({ gameId: 'u3', startDate: null, endDate: '2026-13-01' }),
    ]);
    expect(groups.map(g => g.label)).toEqual(['April 2026', 'Undated']);
    expect(ids(groups[1].entries)).toEqual(['u1', 'u2', 'u3']);
  });

  it('puts "Undated" last whatever order the entries come in', () => {
    const groups = groupByMonth([entry({ gameId: 'u', startDate: null, endDate: null }), entry({ gameId: '1', endDate: '2026-04-19' })]);
    expect(groups.map(g => g.key)).toEqual(['2026-04', 'undated']);
  });

  it('makes no groups from no entries', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

// ─── filtering ────────────────────────────────────────────────────────────────

describe('filterDirectory', () => {
  const all = [
    entry({ gameId: '101', white: 'romank66', black: 'Magnus_C', opponent: 'Magnus_C', result: 'win' }),
    entry({ gameId: '202', white: 'Hikaru_N', black: 'romank66', opponent: 'Hikaru_N', result: 'draw' }),
    entry({ gameId: '303', white: 'romank66', black: 'fabi', opponent: 'fabi', result: 'loss' }),
    entry({ gameId: '404', white: 'romank66', black: 'ding', opponent: 'ding', result: null, inProgress: true }),
  ];

  it('returns everything with no filter', () => {
    expect(ids(filterDirectory(all, NO_FILTER))).toEqual(['101', '202', '303', '404']);
  });

  it('finds an opponent by part of the name, ignoring case', () => {
    expect(ids(filterDirectory(all, { query: 'magnus', result: 'all' }))).toEqual(['101']);
    expect(ids(filterDirectory(all, { query: 'IKA', result: 'all' }))).toEqual(['202']);
    expect(ids(filterDirectory(all, { query: 'dIn', result: 'all' }))).toEqual(['404']);
  });

  it('finds a game by its number', () => {
    expect(ids(filterDirectory(all, { query: '303', result: 'all' }))).toEqual(['303']);
  });

  it('ignores spaces round the search', () => {
    expect(ids(filterDirectory(all, { query: '  fabi  ', result: 'all' }))).toEqual(['303']);
  });

  it('matches either player, so searching the author’s name finds everything they played', () => {
    expect(filterDirectory(all, { query: 'romank66', result: 'all' })).toHaveLength(4);
  });

  it('keeps only one kind of result', () => {
    expect(ids(filterDirectory(all, { query: '', result: 'win' }))).toEqual(['101']);
    expect(ids(filterDirectory(all, { query: '', result: 'draw' }))).toEqual(['202']);
    expect(ids(filterDirectory(all, { query: '', result: 'loss' }))).toEqual(['303']);
  });

  it('leaves out a game with no result when one kind is wanted, and keeps it for all', () => {
    expect(ids(filterDirectory(all, { query: '', result: 'win' }))).not.toContain('404');
    expect(ids(filterDirectory(all, { query: '', result: 'all' }))).toContain('404');
  });

  it('applies both together', () => {
    expect(ids(filterDirectory(all, { query: 'fabi', result: 'loss' }))).toEqual(['303']);
    expect(filterDirectory(all, { query: 'fabi', result: 'win' })).toEqual([]);
  });

  it('finds nothing for a search that matches nothing', () => {
    expect(filterDirectory(all, { query: 'zzz', result: 'all' })).toEqual([]);
  });

  it('keeps the order it was given', () => {
    expect(ids(filterDirectory(all, { query: 'romank66', result: 'all' }))).toEqual(['101', '202', '303', '404']);
  });
});

describe('tallyResults', () => {
  it('counts wins, draws and losses, and all the games', () => {
    expect(tallyResults([entry({ result: 'win' }), entry({ result: 'win' }), entry({ result: 'draw' }), entry({ result: 'loss' }), entry({ result: null })]))
      .toEqual({ total: 5, win: 2, draw: 1, loss: 1 });
  });

  it('copes with nothing', () => {
    expect(tallyResults([])).toEqual({ total: 0, win: 0, draw: 0, loss: 0 });
  });
});
