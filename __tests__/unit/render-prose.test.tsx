import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderProse } from '@/components/blog-shared';

function render(text: string): string {
  return renderToStaticMarkup(<>{renderProse(text)}</>);
}

describe('renderProse', () => {
  it('wraps a single line in one <p>', () => {
    const html = render('Just one line.');
    expect(html).toBe('<p class="">Just one line.</p>');
  });

  it('splits double newlines into separate paragraphs', () => {
    const html = render('First para.\n\nSecond para.');
    expect(html).toBe('<p class="">First para.</p><p class="">Second para.</p>');
  });

  it('preserves single newlines as <br> within a paragraph', () => {
    const html = render('Line one\nLine two');
    expect(html).toBe('<p class="">Line one<br/>Line two</p>');
  });

  it('handles a mix of blank lines and single line breaks', () => {
    const html = render('A\nB\n\nC');
    expect(html).toContain('<p class="">A<br/>B</p>');
    expect(html).toContain('<p class="">C</p>');
  });

  it('renders **bold** within a line', () => {
    const html = render('Hello **world**!');
    expect(html).toBe('<p class="">Hello <strong>world</strong>!</p>');
  });

  it('threading: bold across line breaks in the same paragraph', () => {
    const html = render('**What went well:** Solid prep.\nGood time use.');
    expect(html).toContain('<strong>What went well:</strong>');
    expect(html).toContain('<br/>');
  });

  it('collapses 3+ blank lines to a single paragraph break', () => {
    const html = render('A\n\n\n\nB');
    expect(html).toBe('<p class="">A</p><p class="">B</p>');
  });

  it('applies an optional paragraphClass to each <p>', () => {
    const html = renderToStaticMarkup(<>{renderProse('A\n\nB', 'foo bar')}</>);
    expect(html).toBe('<p class="foo bar">A</p><p class="foo bar">B</p>');
  });
});

// ─── chess notation ───────────────────────────────────────────────────────────

/** The text inside each notation chip, in order. */
const chips = (html: string) => [...html.matchAll(/<span data-notation="true"[^>]*>([^<]*)<\/span>/g)].map(m => m[1]);

/** The visible text of rendered markup. */
const textOf = (html: string) =>
  html.replace(/<br\/>/g, '\n').replace(/<\/p><p[^>]*>/g, '\n\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

describe('renderProse — chess notation', () => {
  it('sets a variation apart from the words around it', () => {
    const html = render('I should have played 9...Bxd2+ 10. Nxd2 here.');

    expect(chips(html)).toEqual(['9...Bxd2+ 10. Nxd2']);
    expect(html).toContain('I should have played <span');
    expect(html).toContain('</span> here.');
  });

  it('sets a lone move apart', () => {
    expect(chips(render('Then Nf3 and d4.'))).toEqual(['Nf3', 'd4']);
  });

  it('makes the chip monospaced and tinted, with a dark-mode treatment', () => {
    const html = render('Nf3');

    expect(html).toContain('font-mono');
    expect(html).toContain('bg-slate-200');
    expect(html).toContain('text-slate-900');
    expect(html).toContain('dark:bg-slate-700/70');
    expect(html).toContain('dark:text-slate-50');
  });

  it('keeps the chip upright inside italic text, and repainted when it wraps over two lines', () => {
    const html = render('Nf3');

    expect(html).toContain('not-italic');
    expect(html).toContain('box-decoration-clone');
  });

  it('leaves ordinary text exactly as it was', () => {
    expect(render('No moves here, just words.')).toBe('<p class="">No moves here, just words.</p>');
    expect(chips(render('No moves here, just words.'))).toEqual([]);
  });

  it('works inside **bold**', () => {
    const html = render('The **key move Nf3** wins');

    expect(html).toContain('<strong>key move <span');
    expect(chips(html)).toEqual(['Nf3']);
  });

  it('works when the whole bold phrase is notation', () => {
    const html = render('**10. Nxd2** was forced');

    expect(html).toContain('<strong><span');
    expect(chips(html)).toEqual(['10. Nxd2']);
  });

  it('works on every line of a paragraph, without joining moves across a line break', () => {
    const html = render('First Nf3\nthen d4');

    expect(chips(html)).toEqual(['Nf3', 'd4']);
    expect(html).toContain('<br/>');
  });

  it('works in every paragraph', () => {
    expect(chips(render('One Nf3.\n\nTwo Bb5.'))).toEqual(['Nf3', 'Bb5']);
  });

  it('never changes the words: the visible text is the original text', () => {
    const text = 'Protecting e4 before ...exd4 and 10. Nxd2 Qxd2+!\n\nThe **key** idea: O-O-O, then Rhe1.';
    expect(textOf(render(text))).toBe(text.replace(/\*\*/g, ''));
  });

  it('escapes anything that is not text: markup in a comment stays text', () => {
    const html = render('<b>Nf3</b> & <script>alert(1)</script>');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });
});

// ─── hyperlinks ───────────────────────────────────────────────────────────────

/** Each link in the markup: its href and the text it shows. */
const anchors = (html: string) =>
  [...html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(m => ({ href: m[1], text: m[2] }));

describe('renderProse — hyperlinks', () => {
  const GAME = 'https://www.chess.com/game/daily/899870281?move=0';

  it('turns a web address into a link, showing the address', () => {
    const html = render(`The game is at ${GAME} if you want it.`);

    expect(anchors(html)).toEqual([{ href: GAME, text: GAME }]);
    expect(html).toContain('The game is at <a ');
    expect(html).toContain('</a> if you want it.');
  });

  it('opens links in a new tab without handing the page to the destination', () => {
    const html = render(GAME);

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('styles a link so it reads as one, in light and dark mode', () => {
    const html = render(GAME);

    expect(html).toContain('underline');
    expect(html).toContain('text-blue-700');
    expect(html).toContain('dark:text-blue-300');
  });

  it('lets a long address wrap instead of widening the card', () => {
    expect(render(GAME)).toContain('[overflow-wrap:anywhere]');
  });

  it('leaves the full stop after an address outside the link', () => {
    const html = render(`See ${GAME}.`);

    expect(anchors(html)[0].href).toBe(GAME);
    expect(html).toMatch(/<\/a>\.<\/p>$/);
  });

  it('works inside **bold**', () => {
    const html = render(`**Watch ${GAME}** closely`);

    expect(html).toContain('<strong>Watch <a ');
    expect(anchors(html)).toEqual([{ href: GAME, text: GAME }]);
  });

  it('works on every line and in every paragraph', () => {
    const html = render('One https://a.com/1\nTwo https://b.com/2\n\nThree https://c.com/3');
    expect(anchors(html).map(a => a.href)).toEqual(['https://a.com/1', 'https://b.com/2', 'https://c.com/3']);
  });

  it('does not mistake chess-looking text inside an address for notation', () => {
    const html = render('See https://example.com/e4/Nf3/Bb5?move=0 now');

    expect(chips(html)).toEqual([]);
    expect(anchors(html)[0].href).toBe('https://example.com/e4/Nf3/Bb5?move=0');
  });

  it('still sets notation apart in the words around a link', () => {
    const html = render(`After 9...Bxd2+ 10. Nxd2 see ${GAME} and Qxd2.`);

    expect(chips(html)).toEqual(['9...Bxd2+ 10. Nxd2', 'Qxd2']);
    expect(anchors(html)).toEqual([{ href: GAME, text: GAME }]);
  });

  it('writes an ampersand in an address correctly in the markup', () => {
    const html = render('https://a.com/x?a=1&b=2');

    expect(html).toContain('href="https://a.com/x?a=1&amp;b=2"');
    expect(html).not.toContain('a=1&b=2');
  });

  it('never makes a link from a scheme other than http or https', () => {
    const html = render('javascript:alert(1) data:text/html,hi ftp://a.com/x file:///etc/passwd');

    expect(anchors(html)).toEqual([]);
    expect(html).not.toContain('<a ');
  });

  it('cannot be tricked into a script link by markup in the text', () => {
    const html = render('<a href="javascript:alert(1)">x</a> https://ok.com/a');

    expect(html).not.toContain('<a href="javascript');
    expect(html).toContain('&lt;a href=');
    expect(anchors(html)).toEqual([{ href: 'https://ok.com/a', text: 'https://ok.com/a' }]);
  });

  it('leaves text with no address exactly as it was', () => {
    expect(render('No links here.')).toBe('<p class="">No links here.</p>');
  });

  it('never changes the words: the visible text is the original text', () => {
    const text = `See ${GAME}, (and https://a.com/x).\n\nThen **bold https://b.com/y** and Nf3.`;
    expect(textOf(render(text))).toBe(text.replace(/\*\*/g, ''));
  });
});
