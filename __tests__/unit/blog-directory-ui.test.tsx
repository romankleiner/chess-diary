import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
// The matcher Clerk's createRouteMatcher is built on. (The test setup replaces
// createRouteMatcher itself with a stub that matches nothing.)
import { createPathMatcher } from '@clerk/shared/pathMatcher';
import type { DirectoryEntry } from '@/lib/blog-directory';
import { PUBLIC_ROUTES } from '@/lib/public-routes';
import { BlogDirectory } from '@/components/BlogDirectory';

const entry = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  gameId: '100', white: 'romank66', black: 'opponent_a', whiteRating: 1523, blackRating: 1480, authorColor: 'white', opponent: 'opponent_a',
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
    expect(html.match(/<li /g)).toHaveLength(3);
  });

  it('names the players, white against black, each with their rating', () => {
    expect(text).toContain('romank66 (1523) vs Late_One (1480)');
    expect(text).toContain('romank66 (1523) vs Middle_One (1480)');
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

// ─── ratings and profiles in the directory ────────────────────────────────────

describe('BlogDirectory — ratings and profile links', () => {
  const one = (over: Partial<DirectoryEntry> = {}) => renderToStaticMarkup(<BlogDirectory entries={[entry(over)]} />);
  const anchors = (html: string) => [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(m => ({ attrs: m[1], inner: m[2] }));
  const profile = (html: string) => anchors(html).filter(a => a.attrs.includes('chess.com'));

  it('shows a player without a rating as just their name', () => {
    const text = textOf(one({ whiteRating: null }));
    expect(text).toContain('romank66 vs opponent_a (1480)');
    expect(textOf(one({ whiteRating: null, blackRating: null }))).toContain('romank66 vs opponent_a');
  });

  it('shows a rating beside each name, white’s with white and black’s with black', () => {
    expect(textOf(one({ whiteRating: 900, blackRating: 2100 }))).toContain('romank66 (900) vs opponent_a (2100)');
  });

  it('links both players to their Chess.com profiles', () => {
    const links = profile(one());
    expect(links).toHaveLength(2);
    expect(links[0].attrs).toContain('href="https://www.chess.com/member/romank66"');
    expect(links[1].attrs).toContain('href="https://www.chess.com/member/opponent_a"');
    expect(textOf(links[0].inner)).toContain('romank66');
    expect(textOf(links[1].inner)).toContain('opponent_a');
  });

  it('opens a profile in a new tab, without handing the page to it', () => {
    for (const link of profile(one())) {
      expect(link.attrs).toContain('target="_blank"');
      expect(link.attrs).toContain('rel="noopener noreferrer"');
      expect(textOf(link.inner)).toContain('opens in a new tab');
    }
  });

  it('labels the profile links', () => {
    expect(textOf(one())).toContain('Chess.com profiles: romank66');
  });

  it('keeps the blog link as the title, and one profile pair for each game', () => {
    const html = renderToStaticMarkup(<BlogDirectory entries={entries} />);
    expect(profile(html)).toHaveLength(6);
    expect(anchors(html).filter(a => a.attrs.includes('href="/blog/'))).toHaveLength(3);
  });

  it('never puts a link inside a link, which HTML does not allow', () => {
    const html = renderToStaticMarkup(<BlogDirectory entries={entries} />);
    expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /);
  });

  it('lets the whole card open the blog, with the profile links kept above that', () => {
    const html = one();
    const [blog] = anchors(html).filter(a => a.attrs.includes('href="/blog/'));
    expect(blog.attrs).toContain("after:absolute");
    expect(blog.attrs).toContain('after:inset-0');
    expect(html).toMatch(/<li class="relative /);
    // each profile link sits in something above the overlay
    expect(html.match(/<span class="relative z-10"><a /g)).toHaveLength(2);
  });

  it('shows a name that is not a plausible Chess.com username as plain text, not a link', () => {
    const html = one({ white: '../evil?x=1', whiteRating: 1500 });
    expect(profile(html)).toHaveLength(1);
    expect(html).not.toContain('chess.com/member/..');
    expect(textOf(html)).toContain('Chess.com profiles: ../evil?x=1');
  });

  it('shows a rating beside a name in the title, not in the profile links', () => {
    const profiles = textOf(one()).split('Chess.com profiles:')[1];
    expect(profiles).not.toContain('1523');
    expect(profiles).not.toContain('1480');
  });

  it('puts the rating in the accessible name of the blog link, so the card reads out in full', () => {
    const [blog] = anchors(one()).filter(a => a.attrs.includes('href="/blog/'));
    expect(textOf(blog.inner)).toBe('romank66 (1523) vs opponent_a (1480)');
  });
});

// ─── who can open it ──────────────────────────────────────────────────────────
// (The directory page's own rules -- the secret key, the author -- are tested in
// blog-directory-page.test.tsx.)

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
    for (const path of [
      '/', '/journal', '/games', '/settings', '/api/games', '/api/journal', '/api/games/952794945/share', '/backups',
      '/visitors', '/api/blog-visits', '/api/blog-directory/key',
    ]) {
      expect(open(path), path).toBe(false);
    }
  });

  it('does not open routes that merely start with "/blog"', () => {
    expect(open('/blogger')).toBe(false);
    expect(open('/api/blog')).toBe(false);
  });
});
