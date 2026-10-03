import { describe, it, expect } from 'vitest';
import { splitLinks } from '@/lib/linkify';

/** Just the addresses that were recognised, in order. */
const links = (text: string) => splitLinks(text).filter(s => s.href !== null).map(s => s.href);

describe('splitLinks — what it links', () => {
  it('links a Chess.com game address with a query, as an author would paste it', () => {
    const url = 'https://www.chess.com/game/daily/899870281?move=0';
    expect(links(`See ${url} for the game.`)).toEqual([url]);
  });

  it('shows the address as it was written', () => {
    const [link] = splitLinks('Look: https://www.chess.com/game/daily/899870281?move=0').filter(s => s.href);
    expect(link.text).toBe('https://www.chess.com/game/daily/899870281?move=0');
    expect(link.href).toBe(link.text);
  });

  it('links http as well as https', () => {
    expect(links('go to http://example.com/a now')).toEqual(['http://example.com/a']);
  });

  it('links an address written with capital letters in the scheme', () => {
    expect(links('go to HTTPS://Example.com/A now')).toEqual(['HTTPS://Example.com/A']);
  });

  it('keeps a query string, fragment, ampersands, percent-encoding and a port', () => {
    const url = 'https://example.com:8080/a/b%20c?x=1&y=2#frag';
    expect(links(`open ${url} please`)).toEqual([url]);
  });

  it('keeps non-ASCII characters in an address', () => {
    expect(links('see https://example.com/stra%C3%9Fe/é here')).toEqual(['https://example.com/stra%C3%9Fe/é']);
  });

  it('links several addresses in one text', () => {
    expect(links('first https://a.com/1 then https://b.com/2, and https://c.com/3.')).toEqual([
      'https://a.com/1', 'https://b.com/2', 'https://c.com/3',
    ]);
  });

  it('links an address at the very start, the very end, and on its own', () => {
    expect(links('https://a.com/x is first')).toEqual(['https://a.com/x']);
    expect(links('last is https://a.com/x')).toEqual(['https://a.com/x']);
    expect(links('https://a.com/x')).toEqual(['https://a.com/x']);
  });

  it('ends an address at a line break', () => {
    expect(links('https://a.com/x\nhttps://b.com/y')).toEqual(['https://a.com/x', 'https://b.com/y']);
  });

  it('ends an address at angle brackets and quotes', () => {
    expect(links('<https://a.com/x>')).toEqual(['https://a.com/x']);
    expect(links('"https://a.com/x"')).toEqual(['https://a.com/x']);
    expect(links("'https://a.com/x'")).toEqual(['https://a.com/x']);
    expect(links('“https://a.com/x”')).toEqual(['https://a.com/x']);
  });
});

describe('splitLinks — punctuation around an address', () => {
  it.each([
    ['a full stop', 'See https://a.com/x.', 'https://a.com/x'],
    ['a comma', 'See https://a.com/x, then', 'https://a.com/x'],
    ['a semicolon', 'See https://a.com/x; then', 'https://a.com/x'],
    ['a colon', 'See https://a.com/x: it', 'https://a.com/x'],
    ['an exclamation mark', 'See https://a.com/x!', 'https://a.com/x'],
    ['a question mark', 'Is it https://a.com/x?', 'https://a.com/x'],
    ['an ellipsis', 'See https://a.com/x…', 'https://a.com/x'],
    ['several marks', 'See https://a.com/x?!.', 'https://a.com/x'],
    ['markdown emphasis', 'See *https://a.com/x*', 'https://a.com/x'],
  ])('leaves out %s at the end', (_name, text, expected) => {
    expect(links(text)).toEqual([expected]);
  });

  it('keeps a query that ends the address, even though ? is punctuation elsewhere', () => {
    expect(links('see https://a.com/x?move=0 now')).toEqual(['https://a.com/x?move=0']);
  });

  it('leaves out a closing bracket that has no opener inside the address', () => {
    expect(links('(see https://a.com/x)')).toEqual(['https://a.com/x']);
    expect(links('[see https://a.com/x]')).toEqual(['https://a.com/x']);
    expect(links('(see https://a.com/x).')).toEqual(['https://a.com/x']);
    expect(links('(see https://a.com/x), then')).toEqual(['https://a.com/x']);
  });

  it('keeps a closing bracket that matches one inside the address', () => {
    const wiki = 'https://en.wikipedia.org/wiki/Ruy_Lopez_(opening)';
    expect(links(`read ${wiki}`)).toEqual([wiki]);
    expect(links(`(read ${wiki})`)).toEqual([wiki]);
    expect(links(`read ${wiki}.`)).toEqual([wiki]);
  });

  it('handles a markdown-style link, linking the address and leaving the rest', () => {
    const segments = splitLinks('[the game](https://www.chess.com/game/daily/1?move=0) was fun');
    expect(segments.map(s => s.text)).toEqual(['[the game](', 'https://www.chess.com/game/daily/1?move=0', ') was fun']);
    expect(segments.filter(s => s.href)).toHaveLength(1);
  });

  it('leaves the trailing punctuation as ordinary text after the link', () => {
    expect(splitLinks('see https://a.com/x.')).toEqual([
      { text: 'see ', href: null },
      { text: 'https://a.com/x', href: 'https://a.com/x' },
      { text: '.', href: null },
    ]);
  });
});

describe('splitLinks — what it does not link', () => {
  it.each([
    'No links here, just words.',
    'Visit www.chess.com/game for more.',
    'Or chess.com/game/daily/1',
    'a file called notes.txt and e.g. this',
    'version 1.2.3 of the book',
    'mailto:someone@example.com',
    'ftp://example.com/file',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'https://',
    'http://.',
    'https:// not an address',
    'https:///only-a-path',
    'https://-',
    'https://-/page',
    'https://_/page',
    'https://--/',
    '',
  ])('finds nothing in: %s', text => {
    expect(links(text)).toEqual([]);
  });

  it('does not let a scheme-looking string inside another word become a link', () => {
    // It still needs a real host after the scheme
    expect(links('xhttps://')).toEqual([]);
  });

  it('never produces an address with any scheme but http or https', () => {
    const text = 'x javascript:alert(1) https://ok.com/a data:text/html,hi ftp://f.com/x vbscript:run http://also.ok/b';
    for (const href of links(text)) expect(href).toMatch(/^https?:\/\//i);
    expect(links(text)).toEqual(['https://ok.com/a', 'http://also.ok/b']);
  });

  it('still links an address on a single-word host, such as a local one', () => {
    expect(links('try http://localhost:3000/blog/1 now')).toEqual(['http://localhost:3000/blog/1']);
    expect(links('and http://192.168.0.1/admin')).toEqual(['http://192.168.0.1/admin']);
  });

  it('skips an unusable address and still finds the next good one', () => {
    expect(links('bad https://. then good https://a.com/x')).toEqual(['https://a.com/x']);
  });
});

describe('splitLinks — the segments', () => {
  it('gives back exactly the text it was given, in order', () => {
    const samples = [
      'See https://www.chess.com/game/daily/899870281?move=0 for the game.',
      '(see https://a.com/x), then https://b.com/y.',
      'no links at all',
      '',
      'https://a.com/x',
      'ends with https://a.com/x.',
      'https://a.com/x starts with one',
      '[the game](https://a.com/x) and *https://b.com/y*',
      'bad https://. and https://a.com/x?!',
      'two\nlines https://a.com/x\nhttps://b.com/y',
    ];
    for (const text of samples) {
      expect(splitLinks(text).map(s => s.text).join('')).toBe(text);
    }
  });

  it('never returns an empty segment', () => {
    for (const text of ['https://a.com/x', 'a https://a.com/x', 'https://a.com/x a', '', 'x', 'https://a.com/x.']) {
      expect(splitLinks(text).every(s => s.text.length > 0)).toBe(true);
    }
  });

  it('returns nothing for empty text, and one plain segment when there is no link', () => {
    expect(splitLinks('')).toEqual([]);
    expect(splitLinks('just words')).toEqual([{ text: 'just words', href: null }]);
  });

  it('marks links and words alternately', () => {
    expect(splitLinks('go https://a.com/x now')).toEqual([
      { text: 'go ', href: null },
      { text: 'https://a.com/x', href: 'https://a.com/x' },
      { text: ' now', href: null },
    ]);
  });

  it('can be called repeatedly with the same results (no state carried between calls)', () => {
    const text = 'go https://a.com/x then https://b.com/y';
    expect(splitLinks(text)).toEqual(splitLinks(text));
    expect(links(text)).toEqual(links(text));
  });

  it('copes with a very long run of address-like text without slowing to a crawl', () => {
    const text = 'https://a.com/' + 'x'.repeat(100_000) + ' ' + 'https://'.repeat(5000);
    const start = performance.now();
    splitLinks(text);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
