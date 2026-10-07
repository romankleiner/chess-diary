import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GamePlayers, PlayerLink } from '@/components/blog-shared';

/** Visible text of rendered markup (what a screen reader hears included). */
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s([,)])/g, '$1').replace(/\(\s/g, '(').trim();
const render = (node: React.ReactElement) => renderToStaticMarkup(node);

// ─── one player ───────────────────────────────────────────────────────────────

describe('PlayerLink', () => {
  it('links the name to the player’s Chess.com profile', () => {
    const html = render(<PlayerLink name="romank66" />);
    expect(html).toContain('href="https://www.chess.com/member/romank66"');
    expect(html).toMatch(/<a [^>]*>romank66</);
  });

  it('opens the profile in a new tab, so a reader keeps their place in the walkthrough', () => {
    const html = render(<PlayerLink name="romank66" />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('says to a screen reader that it is a profile and opens in a new tab', () => {
    expect(render(<PlayerLink name="romank66" />)).toContain('<span class="sr-only"> (Chess.com profile, opens in a new tab)</span>');
  });

  it('shows the rating beside the name, outside the link', () => {
    const html = render(<PlayerLink name="romank66" rating={1523} />);
    expect(html).toMatch(/<\/a><span class="[^"]*">\(<span class="sr-only">rating <\/span>1523\)<\/span>/);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toMatch(/<a [^>]*>[^<]*<span[^>]*>[^<]*<\/span>1523/);
  });

  it('reads the rating out as "rating 1523"', () => {
    expect(textOf(render(<PlayerLink name="romank66" rating={1523} />))).toContain('(rating 1523)');
  });

  it('shows no rating, and no empty brackets, when there is none', () => {
    for (const rating of [null, undefined]) {
      const html = render(<PlayerLink name="romank66" rating={rating} />);
      expect(html).not.toContain('(<span');
      expect(textOf(html)).not.toContain('rating');
      expect(textOf(html)).not.toContain('()');
      expect(textOf(html)).toBe('romank66 (Chess.com profile, opens in a new tab)');
    }
  });

  it('sets a rating in the size it is asked to, relative to the name unless told otherwise', () => {
    expect(render(<PlayerLink name="a" rating={1500} />)).toContain('text-[0.7em]');
    const sized = render(<PlayerLink name="a" rating={1500} ratingClassName="text-xs" />);
    expect(sized).toContain('text-xs');
    expect(sized).not.toContain('text-[0.7em]');
  });

  it('shows a name that is not a plausible Chess.com username as text, not a link', () => {
    for (const name of ['../admin', 'a b', 'javascript:alert(1)', 'a@evil.com', '', 'ünï']) {
      const html = render(<PlayerLink name={name} rating={1500} />);
      expect(html, name).not.toContain('<a ');
      expect(html, name).not.toContain('href=');
    }
  });

  it('still shows the rating of a player it cannot link', () => {
    expect(textOf(render(<PlayerLink name="a b" rating={1500} />))).toContain('a b (rating 1500)');
  });

  it('escapes a name that is not text', () => {
    const html = render(<PlayerLink name="<img src=x onerror=alert(1)>" rating={1500} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('is told apart from plain text by an underline, and has a visible state for keyboard focus', () => {
    const classes = render(<PlayerLink name="romank66" />).match(/<a [^>]*class="([^"]*)"/)![1].split(' ');
    expect(classes).toContain('underline');            // as a class of its own, not just "underline-offset-4"
    expect(classes).toContain('decoration-dotted');
    expect(classes).toContain('focus-visible:decoration-solid');
  });

  it('keeps a dark-mode treatment for the rating', () => {
    expect(render(<PlayerLink name="a" rating={1500} />)).toContain('dark:text-gray-400');
  });
});

// ─── both players ─────────────────────────────────────────────────────────────

describe('GamePlayers', () => {
  const html = render(<GamePlayers white="romank66" black="opponent_a" whiteRating={1523} blackRating={1480} />);

  it('names white against black, each with a rating and a profile link', () => {
    expect(textOf(html)).toBe('romank66 (Chess.com profile, opens in a new tab) (rating 1523) vs opponent_a (Chess.com profile, opens in a new tab) (rating 1480)');
    expect(html.match(/<a /g)).toHaveLength(2);
  });

  it('links each to their own profile, in order', () => {
    expect(html.indexOf('member/romank66')).toBeLessThan(html.indexOf('member/opponent_a'));
  });

  it('puts each rating with the right player', () => {
    expect(html.indexOf('1523')).toBeLessThan(html.indexOf('member/opponent_a'));
    expect(html.indexOf('1480')).toBeGreaterThan(html.indexOf('member/opponent_a'));
  });

  it('copes when only one rating, or neither, is known', () => {
    const one = textOf(render(<GamePlayers white="a1" black="b1" blackRating={1480} />));
    expect(one).toContain('a1 (Chess.com profile, opens in a new tab) vs b1');
    expect(one).toContain('(rating 1480)');
    expect(one).not.toContain('rating undefined');
    expect(textOf(render(<GamePlayers white="a1" black="b1" />))).not.toContain('rating');
  });

  it('passes the size of the ratings on', () => {
    expect(render(<GamePlayers white="a1" black="b1" whiteRating={1} blackRating={2} ratingClassName="text-xs" />).match(/text-xs/g)).toHaveLength(2);
  });
});
