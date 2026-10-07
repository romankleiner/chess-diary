import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
// The matcher Clerk's createRouteMatcher is built on. (The test setup replaces
// createRouteMatcher itself with a stub that matches nothing.)
import { createPathMatcher } from '@clerk/shared/pathMatcher';
import type { DirectoryEntry } from '@/lib/blog-directory';
import { PUBLIC_ROUTES } from '@/lib/public-routes';

vi.mock('@/lib/blog-directory-server', () => ({ loadBlogDirectory: vi.fn() }));

import { BlogDirectory } from '@/components/BlogDirectory';
import BlogDirectoryPage, { dynamic, metadata } from '@/app/blog/page';
import { loadBlogDirectory } from '@/lib/blog-directory-server';

const mockLoad = vi.mocked(loadBlogDirectory);

const entry = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  gameId: '100', white: 'romank66', black: 'opponent_a', authorColor: 'white', opponent: 'opponent_a',
  result: 'win', inProgress: false, startDate: '2026-07-10', endDate: '2026-07-24', timeControl: '1 day per move',
  commentedMoves: 9, hasSummary: true,
  ...over,
});

const entries = [
  entry({ gameId: '300', black: 'Late_One', opponent: 'Late_One', startDate: '2026-09-01', endDate: '2026-09-16', commentedMoves: 1, hasSummary: false }),
  entry({ gameId: '200', black: 'Middle_One', opponent: 'Middle_One', result: 'draw', startDate: '2026-07-20', endDate: '2026-07-30' }),
  entry({ gameId: '100' }),
];

/** Visible text of rendered markup. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// ─── the directory ────────────────────────────────────────────────────────────

describe('BlogDirectory', () => {
  const html = renderToStaticMarkup(<BlogDirectory entries={entries} />);
  const text = textOf(html);

  it('totals the games and their results', () => {
    expect(text).toContain('3 games · 2 wins · 1 draw');
  });

  it('leaves out a kind of result there are none of', () => {
    expect(text).not.toContain('loss');
    const draws = textOf(renderToStaticMarkup(<BlogDirectory entries={[entry({ result: 'draw' })]} />));
    expect(draws).toContain('1 game · 1 draw');
    expect(draws).not.toMatch(/\b0 (wins?|draws?|loss(es)?)/);
    const losses = textOf(renderToStaticMarkup(<BlogDirectory entries={[entry({ result: 'loss' }), entry({ gameId: '2', result: 'loss' })]} />));
    expect(losses).toContain('2 games · 2 losses');
  });

  it('lists each game as a link to its blog', () => {
    for (const id of ['100', '200', '300']) expect(html).toContain(`href="/blog/${id}"`);
    expect(html.match(/<li>/g)).toHaveLength(3);
  });

  it('names the players, white against black', () => {
    expect(text).toContain('romank66 vs Late_One');
    expect(text).toContain('romank66 vs Middle_One');
  });

  it('says how each game ended, when it began and ended, and at what pace', () => {
    expect(text).toContain('Win');
    expect(text).toContain('Draw');
    expect(text).toContain('2026-09-01 – 2026-09-16 · 1 day per move');
  });

  it('says how much was written at each', () => {
    expect(text).toContain('9 commentated moves · overall summary');
    expect(text).toContain('1 commentated move');
  });

  it('groups the games by month, under headings', () => {
    expect(html).toContain('>September 2026</h2>');
    expect(html).toContain('>July 2026</h2>');
    expect(html.indexOf('September 2026')).toBeLessThan(html.indexOf('Late_One'));
    expect(html.indexOf('Late_One')).toBeLessThan(html.indexOf('July 2026'));
  });

  it('keeps the order it is given within a month', () => {
    expect(html.indexOf('Middle_One')).toBeLessThan(html.indexOf('opponent_a'));
  });

  it('offers a search, labelled for a screen reader', () => {
    expect(html).toContain('type="search"');
    expect(html).toContain('for="directory-search"');
    expect(text).toContain('Search by player or game number');
  });

  it('offers a filter by result, with how many of each, starting on All', () => {
    expect(html).toContain('aria-label="Filter by result"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>All <span[^>]*>3</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Wins <span[^>]*>2</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Draws <span[^>]*>1</);
  });

  it('disables a filter there are no games for', () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Losses <span[^>]*>0</);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Wins/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>All/);
  });

  describe('with a search or filter already applied', () => {
    const render = (initialFilter: { query: string; result: 'all' | 'win' | 'draw' | 'loss' }) =>
      renderToStaticMarkup(<BlogDirectory entries={entries} initialFilter={initialFilter} />);

    it('shows only the games that match, and says how many of how many', () => {
      const filtered = render({ query: 'middle', result: 'all' });
      expect(filtered).toContain('href="/blog/200"');
      expect(filtered).not.toContain('href="/blog/300"');
      expect(filtered).not.toContain('href="/blog/100"');
      expect(textOf(filtered)).toContain('Showing 1 of 3');
    });

    it('shows the search in the box', () => {
      expect(render({ query: 'middle', result: 'all' })).toContain('value="middle"');
    });

    it('presses the filter button that is applied', () => {
      const filtered = render({ query: '', result: 'draw' });
      expect(filtered).toMatch(/aria-pressed="true"[^>]*>Draws </);
      expect(filtered).toMatch(/aria-pressed="false"[^>]*>All </);
      expect(textOf(filtered)).toContain('Showing 1 of 3');
    });

    it('keeps the month headings only for months that still have a game', () => {
      const filtered = render({ query: '', result: 'draw' });
      expect(filtered).toContain('>July 2026</h2>');
      expect(filtered).not.toContain('>September 2026</h2>');
    });

    it('says so, and offers to clear, when nothing matches', () => {
      const none = render({ query: 'zzzzz', result: 'all' });
      expect(textOf(none)).toContain('No games match.');
      expect(textOf(none)).toContain('Clear the search and filter');
      expect(none).not.toContain('href="/blog/');
      expect(textOf(none)).toContain('Showing 0 of 3');
    });

    it('does not say "Showing" when the search is only spaces, which filters nothing', () => {
      const blank = render({ query: '   ', result: 'all' });
      expect(textOf(blank)).not.toContain('Showing');
      expect(blank).toContain('href="/blog/300"');
    });
  });

  it('announces nothing about filtering until there is a filter', () => {
    expect(html).toContain('aria-live="polite"');
    expect(text).not.toContain('Showing');
  });

  it('marks a game still being played, with no result to show', () => {
    const live = renderToStaticMarkup(<BlogDirectory entries={[entry({ result: null, inProgress: true, endDate: null })]} />);
    expect(textOf(live)).toContain('In progress');
    expect(live).not.toMatch(/>(Win|Draw|Loss)</);   // no result badge (the filter buttons say "Wins" and so on)
  });

  it('shows no badge for a game that ended some way the directory does not name', () => {
    const odd = renderToStaticMarkup(<BlogDirectory entries={[entry({ result: null, inProgress: false })]} />);
    expect(textOf(odd)).not.toContain('In progress');
    expect(odd).not.toMatch(/>(Win|Draw|Loss)</);
  });

  it('shows a game with no dates, no time control and nothing written without gaps in the line', () => {
    const bare = renderToStaticMarkup(<BlogDirectory entries={[entry({ startDate: null, endDate: null, timeControl: '', commentedMoves: 0, hasSummary: false })]} />);
    expect(textOf(bare)).toContain('No move commentary');
    expect(bare).toContain('Undated');
    expect(bare).not.toContain(' · </p>');
  });

  it('says so when nothing has been shared, with no search or filter to offer', () => {
    const none = renderToStaticMarkup(<BlogDirectory entries={[]} />);
    expect(textOf(none)).toContain('No games have been shared yet.');
    expect(none).not.toContain('type="search"');
  });

  it('escapes anything in a name that is not text', () => {
    const evil = renderToStaticMarkup(<BlogDirectory entries={[entry({ white: '<img src=x onerror=alert(1)>', gameId: '1' })]} />);
    expect(evil).not.toContain('<img');
    expect(evil).toContain('&lt;img');
  });
});

// ─── the page ─────────────────────────────────────────────────────────────────

describe('the directory page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('is read on each visit, not when the site is built', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('has a title and description of its own', () => {
    expect(metadata.title).toBe('Game blogs — Chess Diary');
    expect(String(metadata.description)).toContain('guess the move');
  });

  it('introduces the games and lists them, newest first, whatever order they were read in', async () => {
    mockLoad.mockResolvedValue([entries[2], entries[0], entries[1]]);
    const html = renderToStaticMarkup(await BlogDirectoryPage());

    expect(html).toContain('<h1');
    expect(textOf(html)).toContain('Game blogs');
    expect(textOf(html)).toContain('you can try to guess my move');
    const order = ['300', '200', '100'].map(id => html.indexOf(`href="/blog/${id}"`));
    expect(order.every(i => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('says so, in an alert, when the games cannot be read, rather than failing the page', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockLoad.mockRejectedValue(new Error('redis down'));
    const html = renderToStaticMarkup(await BlogDirectoryPage());

    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('couldn\'t be loaded right now');
    expect(textOf(html)).toContain('Game blogs');
    expect(html).not.toContain('redis down');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('says so, but not as an error, when nothing has been shared', async () => {
    mockLoad.mockResolvedValue([]);
    const html = renderToStaticMarkup(await BlogDirectoryPage());
    expect(textOf(html)).toContain('No games have been shared yet.');
    expect(html).not.toContain('role="alert"');
  });
});

// ─── who can open it ──────────────────────────────────────────────────────────

describe('public routes', () => {
  const open = createPathMatcher(PUBLIC_ROUTES);

  it('lets anyone open the directory and the blogs it lists', () => {
    expect(open('/blog')).toBe(true);
    expect(open('/blog/952794945')).toBe(true);
  });

  it('still lets anyone use what the blogs need', () => {
    expect(open('/api/games/952794945/blog-post')).toBe(true);
    expect(open('/api/eval')).toBe(true);
    expect(open('/sign-in')).toBe(true);
  });

  it('keeps everything else behind sign-in', () => {
    for (const path of ['/', '/journal', '/games', '/settings', '/api/games', '/api/journal', '/api/games/952794945/share', '/backups']) {
      expect(open(path), path).toBe(false);
    }
  });

  it('does not open routes that merely start with "/blog"', () => {
    expect(open('/blogger')).toBe(false);
    expect(open('/api/blog')).toBe(false);
  });
});
