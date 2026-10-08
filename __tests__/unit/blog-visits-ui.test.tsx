import { vi, describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BlogVisit } from '@/lib/access-log';

vi.mock('next/navigation', () => ({ useParams: () => ({ gameId: '952794945' }) }));

import { BlogVisits } from '@/components/BlogVisits';
import { DirectoryShareLink } from '@/components/DirectoryShareLink';
import BlogPage from '@/app/blog/[gameId]/page';

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const now = new Date('2026-10-08T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const v = (over: Partial<BlogVisit> = {}): BlogVisit => ({
  at: hoursAgo(1), page: 'game', gameId: '111', viewer: 'visitor', ip: '203.0.113.7',
  city: 'London', region: 'ENG', country: 'GB', userAgent: CHROME, referrer: 'https://www.google.com/search', ...over,
});

const log: BlogVisit[] = [
  v({ ip: '203.0.113.7' }),
  v({ page: 'directory', gameId: null, ip: '198.51.100.9', referrer: 'https://chess.example/blog', at: hoursAgo(2) }),
  v({ ip: '192.0.2.1', userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)', at: hoursAgo(40) }),
  v({ viewer: 'owner', ip: '10.0.0.1', city: 'Hometown', at: hoursAgo(3) }),
  v({ gameId: '999', ip: '203.0.113.8', at: hoursAgo(24 * 20) }),
];
const render = (over: Partial<Parameters<typeof BlogVisits>[0]> = {}) => renderToStaticMarkup(
  <BlogVisits visits={log} gameNames={{ '111': 'romank66 vs opp_a' }} recording kept={2000} ownOrigin="https://chess.example" now={now} {...over} />,
);

// ─── the visit log ────────────────────────────────────────────────────────────

describe('BlogVisits', () => {
  const html = render();
  const text = textOf(html);

  it('totals the last day, week and month, leaving out the author', () => {
    expect(text).toContain('Last 24 hours 2 views 2 addresses');
    expect(text).toContain('Last 7 days 3 views 3 addresses · 1 by a bot');
    expect(text).toContain('Last 30 days 4 views 4 addresses · 1 by a bot');
  });

  it('lists each visit by others, newest first, leaving the author’s own out at first', () => {
    expect(html.match(/<tr data-viewer=/g)).toHaveLength(4);
    expect(html).not.toContain('data-viewer="owner"');
    expect(text).not.toContain('Hometown');
  });

  it('says which page was read, naming the game and linking to it', () => {
    expect(html).toMatch(/<a [^>]*href="\/blog\/111"[^>]*>romank66 vs opp_a<\/a>/);
    expect(text).toContain('Directory');
  });

  it('names a game it has no name for by its number', () => {
    expect(text).toContain('Game 999');
  });

  it('shows where from, what address, what browser and what page led there', () => {
    expect(text).toContain('London, ENG, GB');
    expect(text).toContain('203.0.113.7');
    expect(text).toContain('Chrome on Windows');
    expect(text).toContain('www.google.com');
    expect(text).toContain('The directory');
  });

  it('marks a bot', () => {
    expect(text).toContain('Bot or script');
    expect(html).toMatch(/>bot<\/span>/);
  });

  it('keeps the full browser description to hand', () => {
    expect(html).toContain(`title="${CHROME}"`);
  });

  it('gives each visit a machine-readable time', () => {
    expect(html).toContain(`<time dateTime="${hoursAgo(1)}">`);
  });

  it('offers to include the author’s own visits, off to begin with', () => {
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*>/);
    expect(text).toContain('Include my own visits');
  });

  it('says how many views are kept', () => {
    expect(text).toContain('The last 2,000 views are kept.');
  });

  it('warns that this copy of the site records nothing, when it doesn’t', () => {
    expect(text).not.toContain('recorded on the live site only');
    expect(textOf(render({ recording: false }))).toContain('Visits are recorded on the live site only');
  });

  it('says so when there is nothing to show', () => {
    const none = textOf(render({ visits: [] }));
    expect(none).toContain('No visits recorded yet.');
    expect(none).toContain('Last 7 days 0 views 0 addresses');
  });

  it('shows nothing but the author’s own visits as nothing yet', () => {
    expect(textOf(render({ visits: [v({ viewer: 'owner' })] }))).toContain('No visits recorded yet.');
  });

  it('escapes anything a visitor put in their headers', () => {
    const evil = render({ visits: [v({ userAgent: '<img src=x onerror=alert(1)>', city: '<script>x</script>', ip: '"><b>' })] });
    expect(evil).not.toContain('<img');
    expect(evil).not.toContain('<script>');
    expect(evil).not.toContain('"><b>');
  });

  it('scrolls the table sideways on a narrow screen rather than squashing it', () => {
    expect(html).toContain('overflow-x-auto');
  });
});

// ─── the author's share box ───────────────────────────────────────────────────

describe('DirectoryShareLink', () => {
  const html = renderToStaticMarkup(<DirectoryShareLink directoryKey="AbCdEfGhIjKlMnOpQrStUv" />);

  it('shows the secret link', () => {
    expect(html).toMatch(/data-directory-link[^>]*>\/blog\?key=AbCdEfGhIjKlMnOpQrStUv</);
  });

  it('offers to copy it and to make a new one', () => {
    expect(textOf(html)).toContain('Copy link');
    expect(textOf(html)).toContain('Make a new link');
  });

  it('says who sees it and what the link does', () => {
    expect(textOf(html)).toContain('Only you see this box');
    expect(textOf(html)).toContain('without it, this page doesn\'t exist');
  });

  it('has a heading for the box, and announces what happens', () => {
    expect(html).toContain('aria-labelledby="share-directory"');
    expect(html).toContain('aria-live="polite"');
  });
});

// ─── a game's page ────────────────────────────────────────────────────────────

describe('a game’s blog page', () => {
  it('shows no link to the directory to a reader who did not come through it', () => {
    // On the server, and for a reader with no remembered key, there is none
    const html = renderToStaticMarkup(<BlogPage />);
    expect(html).not.toContain('All games');
    expect(html).not.toContain('href="/blog"');
    expect(html).not.toContain('/blog?key=');
  });
});
