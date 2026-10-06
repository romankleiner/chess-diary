import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTHOR_WORDS, MoveSectionCard, SectionBody, SummaryCard, renderProse, type MoveSection } from '@/components/blog-shared';

// ─── helpers ──────────────────────────────────────────────────────────────────

const author = (text: string) => renderToStaticMarkup(<>{renderProse(text, undefined, AUTHOR_WORDS)}</>);
const plain = (text: string) => renderToStaticMarkup(<>{renderProse(text)}</>);

/** Text inside each element carrying the given data attribute. */
const inside = (html: string, attribute: string) =>
  [...html.matchAll(new RegExp(`<span ${attribute}="true"[^>]*>([^<]*)</span>`, 'g'))].map(m => m[1]);
const labelsIn = (html: string) => inside(html, 'data-branch-label');
const movesIn = (html: string) => inside(html, 'data-notation');

/** The visible text of rendered markup. */
const textOf = (html: string) =>
  html.replace(/<br\/>/g, '\n').replace(/<\/p><p[^>]*>/g, '\n\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

const section = (over: Partial<MoveSection> = {}): MoveSection => ({
  type: 'move', header: 'Move 3: Bb5', timestamp: '2026-06-01T10:00:00.000Z', fen: null, userColor: 'white',
  thinking: 'x', moveNotation: 'Bb5', opponentLastMove: null, plyIndex: 4, engineEval: null, aiReview: null, postReview: null,
  ...over,
});

// ─── the label itself ─────────────────────────────────────────────────────────

describe('branch labels in the author’s words', () => {
  it('sets "(a3)" apart as a branch label, not a move', () => {
    const html = author('Now (a3) is the interesting one');

    expect(labelsIn(html)).toEqual(['(a3)']);
    expect(movesIn(html)).toEqual([]);
  });

  it('keeps the brackets and the text as written', () => {
    expect(labelsIn(author('see (b21) and b1)'))).toEqual(['(b21)']);
    expect(textOf(author('see (b21) here'))).toBe('see (b21) here');
  });

  it('still sets the moves around it apart as moves', () => {
    const html = author('(a3) 17... Nxe5 18. dxe5 and then Qd2');

    expect(labelsIn(html)).toEqual(['(a3)']);
    expect(movesIn(html)).toEqual(['17... Nxe5 18. dxe5', 'Qd2']);
  });

  it('reads a calculation with several branches', () => {
    const html = author('After 17...Nxe5:\n(a) 18. dxe5 Qxd1\n(b) 18. Rxe5, then (b1) Qxd1 or (b2) Bxe5.');

    expect(labelsIn(html)).toEqual(['(a)', '(b)', '(b1)', '(b2)']);
    expect(movesIn(html)).toEqual(['17...Nxe5', '18. dxe5 Qxd1', '18. Rxe5', 'Qxd1', 'Bxe5']);
  });

  it('reads a roman-numeral item', () => {
    expect(labelsIn(author('(i) first, (ii) second'))).toEqual(['(i)', '(ii)']);
  });

  it('reads a "b1)" that opens a line, on any line of the paragraph', () => {
    const html = author('First line\nb1) 17... Nxe5\nb2) 17... Nxe4');

    expect(labelsIn(html)).toEqual(['b1)', 'b2)']);
    expect(movesIn(html)).toEqual(['17... Nxe5', '17... Nxe4']);
  });

  it('does not read a "b1)" that follows a bold phrase on the same line', () => {
    const html = author('**Note:** b1) go on');

    expect(labelsIn(html)).toEqual([]);
    expect(movesIn(html)).toEqual(['b1']); // as it always was
  });

  it('does read a bracketed label after a bold phrase', () => {
    expect(labelsIn(author('**Note:** (a3) go on'))).toEqual(['(a3)']);
  });

  it('does not read a "b1)" that follows a web address on the same line', () => {
    const html = author('https://example.com b1) go on');

    expect(labelsIn(html)).toEqual([]);
    expect(movesIn(html)).toEqual(['b1']);
  });

  it('still reads a "b1)" that opens the line before a web address', () => {
    expect(labelsIn(author('b1) see https://example.com'))).toEqual(['b1)']);
  });

  it('does not read a "b1)" at the start of bold text: bold carries on from the line, it does not open one', () => {
    const html = author('**b1) go**');

    expect(labelsIn(html)).toEqual([]);
    expect(movesIn(html)).toEqual(['b1']);
  });

  it('works inside bold', () => {
    const html = author('The **key (a3) line** wins');

    expect(labelsIn(html)).toEqual(['(a3)']);
    expect(html).toContain('<strong>key <span');
  });

  it('works in every paragraph', () => {
    expect(labelsIn(author('One (a).\n\nTwo (b).'))).toEqual(['(a)', '(b)']);
  });

  it('leaves a real square or move in brackets a move', () => {
    const html = author('the last move (f6) and then (c5) and (Nf3) and (a3 Nf6)');

    expect(labelsIn(html)).toEqual([]);
    expect(movesIn(html)).toEqual(['f6', 'c5', 'Nf3', 'a3 Nf6']);
  });

  it('does not take text inside a web address for a label', () => {
    const html = author('see https://example.com/(a3)/x and (a3)');

    expect(labelsIn(html)).toEqual(['(a3)']);
    expect(html).toContain('href="https://example.com/(a3)/x"');
  });

  it('never changes the words: the visible text is the original text', () => {
    const text = 'Try (a3) 17...Nxe5 18. dxe5\nb1) go, (iii) too, **(a) bold**, and (f6).\n\n(b21)';
    expect(textOf(author(text))).toBe(text.replace(/\*\*/g, ''));
  });

  it('escapes anything that is not text: markup in a label position stays text', () => {
    const html = author('(a3) <img src=x onerror=alert(1)> (b)');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(labelsIn(html)).toEqual(['(a3)', '(b)']);
  });
});

// ─── how it looks ─────────────────────────────────────────────────────────────

describe('how a branch label is set', () => {
  const html = author('(a3) Nf3');
  const label = html.match(/<span data-branch-label="true" class="([^"]*)"/)![1];
  const move = html.match(/<span data-notation="true" class="([^"]*)"/)![1];

  it('is told apart from a move: a different colour and not monospaced', () => {
    expect(label).toContain('indigo');
    expect(label).not.toContain('font-mono');
    expect(move).toContain('font-mono');
    expect(move).not.toContain('indigo');
  });

  it('is bold enough to stand out, a little smaller than the words around it', () => {
    expect(label).toContain('font-semibold');
    expect(label).toContain('text-[0.85em]');
  });

  it('has a dark-mode treatment', () => {
    expect(label).toContain('dark:bg-indigo-900');
    expect(label).toContain('dark:text-indigo-100');
  });

  it('stays upright in italic text and does not break across lines', () => {
    expect(label).toContain('not-italic');
    expect(label).toContain('whitespace-nowrap');
  });

  it('has an outline, so it keeps its edge on any background', () => {
    expect(label).toContain('ring-1');
    expect(label).toContain('ring-indigo-300');
    expect(label).toContain('dark:ring-indigo-700');
  });

  it('uses a text colour dark enough to read on its tint', () => {
    expect(label).toContain('bg-indigo-100');
    expect(label).toContain('text-indigo-800');
  });
});

// ─── only the author's own words ──────────────────────────────────────────────

describe('branch labels only in the author’s own words', () => {
  it('reads "(a3)" as a move in text not marked as the author’s, as before', () => {
    const html = plain('Now (a3) is the interesting one');

    expect(labelsIn(html)).toEqual([]);
    expect(movesIn(html)).toEqual(['a3']);
  });

  it('is off unless asked for', () => {
    expect(labelsIn(plain('(a) (b2) (iii) (a3)'))).toEqual([]);
  });

  it('reads the author’s labels and the AI’s squares differently in one entry', () => {
    const html = renderToStaticMarkup(
      <SectionBody
        section={section({
          thinking: 'In (a3) I play Nf3.',
          aiReview: 'An advanced pawn (e4) and the line (a3) are both fine.',
          postReview: 'Looking back, (b1) was better than (b2).',
        })}
        phase="complete"
      />,
    );
    const [thinking, ai, post] = html.split(/(?=AI analysis|My post-game analysis)/);

    expect(labelsIn(thinking)).toEqual(['(a3)']);
    expect(movesIn(thinking)).toEqual(['Nf3']);

    expect(labelsIn(ai)).toEqual([]);              // the AI's (e4) and (a3) are squares
    expect(movesIn(ai)).toEqual(['e4', 'a3']);

    expect(labelsIn(post)).toEqual(['(b1)', '(b2)']);
  });

  it('applies to the older card as well', () => {
    const html = renderToStaticMarkup(
      <MoveSectionCard
        section={section({
          moveNotation: null,
          thinking: 'In (a3) I play Nf3.',
          aiReview: 'The pawn (e4) is strong.',
          postReview: 'Then (b2) was best.',
        })}
      />,
    );
    const [thinking, ai, post] = html.split(/(?=AI analysis|My post-game analysis)/);

    expect(labelsIn(thinking)).toEqual(['(a3)']);
    expect(labelsIn(ai)).toEqual([]);
    expect(movesIn(ai)).toEqual(['e4']);
    expect(labelsIn(post)).toEqual(['(b2)']);
  });

  it('applies to the overall summary, which is the author’s own too', () => {
    const html = renderToStaticMarkup(<SummaryCard summary="In (a3) I should have played Nf3." />);

    expect(labelsIn(html)).toEqual(['(a3)']);
    expect(movesIn(html)).toEqual(['Nf3']);
  });

  it('marks AUTHOR_WORDS for branch labels and nothing else', () => {
    expect(AUTHOR_WORDS).toEqual({ branchLabels: true });
  });
});
