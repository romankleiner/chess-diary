import { describe, it, expect } from 'vitest';
import { splitNotation } from '@/lib/notation';

const AUTHOR = { branchLabels: true } as const;

/** What was recognised, as [kind, text] for everything that is not ordinary words. */
const marked = (text: string, options: { branchLabels?: boolean } = AUTHOR) =>
  splitNotation(text, options).filter(s => s.kind !== 'text').map(s => [s.kind, s.text]);
const labels = (text: string) => marked(text).filter(([kind]) => kind === 'branch').map(([, t]) => t);
const moves = (text: string) => marked(text).filter(([kind]) => kind === 'move').map(([, t]) => t);

describe('branch labels — what is one', () => {
  it('is not a move: "(a3)" names the third sub-variation of variation a', () => {
    expect(marked('Now (a3) is the interesting one')).toEqual([['branch', '(a3)']]);
  });

  it.each(['(a)', '(b)', '(c)', '(d)', '(e)', '(f)', '(g)', '(h)'])('recognises the variation %s', label => {
    expect(labels(`In ${label} I play on`)).toEqual([label]);
  });

  it.each(['(i)', '(ii)', '(iii)', '(iv)', '(v)', '(vi)', '(vii)', '(viii)', '(ix)', '(x)'])('recognises the numbered item %s', label => {
    expect(labels(`In ${label} I play on`)).toEqual([label]);
  });

  it.each([
    '(a1)', '(a2)', '(a3)', '(a4)', '(b1)', '(b2)', '(b3)', '(b4)', '(c1)', '(c2)', '(d1)', '(d2)', '(e4)',
  ])('recognises the sub-variation %s, which is also the shape of a pawn move', label => {
    expect(labels(`Line ${label} runs on`)).toEqual([label]);
    expect(moves(`Line ${label} runs on`)).toEqual([]);
  });

  it.each(['(a21)', '(b21)', '(b22)', '(c12)', '(a123)', '(h10)'])('recognises the deeper sub-variation %s, which cannot be a square', label => {
    expect(labels(`Line ${label} runs on`)).toEqual([label]);
  });

  it('recognises a label opening a line, written "b1)" as in a list', () => {
    expect(labels('b1) 17... Nxe5 18. dxe5')).toEqual(['b1)']);
    expect(labels('Some words.\nb2) 17... Nxe5')).toEqual(['b2)']);
    expect(labels('a) first\nb) second\nii) third')).toEqual(['a)', 'b)', 'ii)']);
  });

  it('allows the opening of a line to be indented', () => {
    expect(labels('  b1) 17... Nxe5')).toEqual(['b1)']);
    expect(labels('Words\n\t(a) and\n   a2) then')).toEqual(['(a)', 'a2)']);
  });

  it('recognises a label at the very start and very end of the text', () => {
    expect(labels('(a3) is best')).toEqual(['(a3)']);
    expect(labels('it is (a3)')).toEqual(['(a3)']);
    expect(labels('(a3)')).toEqual(['(a3)']);
  });

  it('recognises a label followed by the punctuation the author uses', () => {
    for (const after of [',', '.', ';', ':', '?', '!', ' ', '-', ' —']) {
      expect(labels(`In (a3)${after} I play`)).toEqual(['(a3)']);
    }
  });

  it('recognises several labels in one text, including two together', () => {
    expect(labels('(a) Nf3 or (b) d4, then (a1), (a2) and (b21).')).toEqual(['(a)', '(b)', '(a1)', '(a2)', '(b21)']);
    expect(labels('(a)(b)(c)')).toEqual(['(a)', '(b)', '(c)']);
    expect(labels('(a) (b) (c1)')).toEqual(['(a)', '(b)', '(c1)']);
  });
});

describe('branch labels — what stays a move', () => {
  it.each(['(a5)', '(a6)', '(a7)', '(a8)', '(b5)', '(c5)', '(e5)', '(f6)', '(g1)', '(g8)', '(h4)', '(f2)', '(e8)'])(
    'keeps %s a move: a rank of 5-8, or a file beyond e, is a real square',
    label => {
      expect(moves(`the last move ${label} was`)).toEqual([label.slice(1, -1)]);
      expect(labels(`the last move ${label} was`)).toEqual([]);
    },
  );

  it('keeps the moves inside a variation in brackets', () => {
    expect(moves('(a3 Nf6 Nf3)')).toEqual(['a3 Nf6 Nf3']);
    expect(labels('(a3 Nf6 Nf3)')).toEqual([]);
    expect(moves('(1. e4 e5)')).toEqual(['1. e4 e5']);
    expect(moves('(9...Bxd2+ 10. Nxd2)')).toEqual(['9...Bxd2+ 10. Nxd2']);
  });

  it('keeps a lone piece move or castling in brackets a move', () => {
    expect(moves('(Nf3)')).toEqual(['Nf3']);
    expect(moves('(O-O)')).toEqual(['O-O']);
    expect(moves('(Bxd2+)')).toEqual(['Bxd2+']);
    expect(labels('(Nf3) (O-O) (Bxd2+)')).toEqual([]);
  });

  it('does not take a label out of a word: "move(s)" is not branch (s)', () => {
    expect(labels('the move(s) are')).toEqual([]);
    expect(labels('f(a) and x(b2)')).toEqual([]);
    expect(labels('Nf3(a)')).toEqual([]);
  });

  it('does not take a longer word in brackets for a label', () => {
    for (const text of ['(aa)', '(ab)', '(abc)', '(a b)', '(a 3)', '(a-3)', '(a,3)', '(a3b)', '(a3.1)', '(ia)', '(xx)', '(iiii)', '(ivv)']) {
      expect(labels(`see ${text} here`), text).toEqual([]);
    }
  });

  it('does not take a label that a word runs on from: it is a token on its own', () => {
    for (const text of ['(a)typical', '(a3)Nf3', '(b)x', '(iii)rd']) {
      expect(labels(`see ${text} here`), text).toEqual([]);
    }
    // the same at the start of a line
    expect(labels('b1)Nf3 and on')).toEqual([]);
    expect(labels('Words\nii)rd')).toEqual([]);
  });

  it('does not take capitals for labels, which the author does not use', () => {
    expect(labels('see (A) and (A3) and (B2) here')).toEqual([]);
  });

  it('does not take digits alone for labels', () => {
    expect(labels('see (1) and (12) and (3.5) here')).toEqual([]);
  });

  it('does not take an unbracketed square for a label', () => {
    expect(labels('the pawn on a3 and b2')).toEqual([]);
    expect(moves('the pawn on a3 and b2')).toEqual(['a3', 'b2']);
  });

  it('only takes a "b1)" at the start of a line, not in the middle of one', () => {
    expect(labels('I considered b1) and then')).toEqual([]);
    expect(labels('(see line\nb1)')).toEqual(['b1)']); // opens a line, so it is read as one
  });

  it('does not take a bracket with a word in it for a label', () => {
    expect(labels('(forced) and (see above) and (a good move)')).toEqual([]);
  });
});

describe('branch labels — text that carries on from earlier in a line', () => {
  // renderProse splits a line at **bold**, so the piece after one is not the start of a line
  const mid = (text: string) => splitNotation(text, { branchLabels: true, startsLine: false }).filter(s => s.kind === 'branch').map(s => s.text);

  it('does not read a "b1)" at the start of such text as a list label', () => {
    expect(mid('b1) 17... Nxe5')).toEqual([]);
    expect(mid('  b1) 17... Nxe5')).toEqual([]);
  });

  it('still reads a bracketed label there', () => {
    expect(mid('(a3) 17... Nxe5')).toEqual(['(a3)']);
    expect(mid(' (b21) then')).toEqual(['(b21)']);
  });

  it('still reads a "b1)" after a line break inside it', () => {
    expect(mid('go on\nb1) 17... Nxe5')).toEqual(['b1)']);
  });

  it('treats the start of the text as the start of a line by default', () => {
    expect(splitNotation('b1) go', { branchLabels: true }).some(s => s.kind === 'branch')).toBe(true);
    expect(splitNotation('b1) go', { branchLabels: true, startsLine: true }).some(s => s.kind === 'branch')).toBe(true);
  });

  it('makes no difference when branch labels are off', () => {
    expect(splitNotation('b1) go', { startsLine: false })).toEqual(splitNotation('b1) go'));
  });

  it('still gives back exactly the text it was given', () => {
    for (const text of ['b1) go', '(a) b2) (c)', 'x\nb1)\n(a)']) {
      expect(splitNotation(text, { branchLabels: true, startsLine: false }).map(s => s.text).join('')).toBe(text);
    }
  });
});

describe('branch labels — beside moves', () => {
  it('still marks the moves around a label', () => {
    expect(marked('(a3) 17... Nxe5 18. dxe5')).toEqual([['branch', '(a3)'], ['move', '17... Nxe5 18. dxe5']]);
  });

  it('marks the moves in each branch separately', () => {
    expect(marked('(a) Nf3 e5, (b) d4 d5')).toEqual([
      ['branch', '(a)'], ['move', 'Nf3 e5'], ['branch', '(b)'], ['move', 'd4 d5'],
    ]);
  });

  it('does not join moves on either side of a label into one run', () => {
    expect(moves('Nf3 (a2) Nc6')).toEqual(['Nf3', 'Nc6']);
  });

  it('handles the line-start form followed by moves', () => {
    expect(marked('b1) 17... Nxe5')).toEqual([['branch', 'b1)'], ['move', '17... Nxe5']]);
  });

  it('handles a realistic paragraph of the author’s calculation', () => {
    const text = 'After 17...Nxe5 I have two tries.\n(a) 18. dxe5 Qxd1 is bad.\n(b) 18. Rxe5, and then (b1) Qxd1 or (b2) Bxe5.';
    expect(labels(text)).toEqual(['(a)', '(b)', '(b1)', '(b2)']);
    expect(moves(text)).toEqual(['17...Nxe5', '18. dxe5 Qxd1', '18. Rxe5', 'Qxd1', 'Bxe5']);
  });
});

describe('branch labels — only for the author’s own words', () => {
  it('is off by default: a lone "(a3)" is a move, as it has always been', () => {
    expect(marked('Now (a3) is the interesting one', {})).toEqual([['move', 'a3']]);
    expect(splitNotation('Now (a3) is the interesting one')).toEqual(splitNotation('Now (a3) is the interesting one', { branchLabels: false }));
  });

  it('leaves the AI’s squares and moves in brackets as moves', () => {
    for (const text of ['an advanced pawn (e4) and the bishop', 'a concrete counter (b4).', 'the plan (g5) before', 'a pawn advance (c5)']) {
      const found = marked(text, {});
      expect(found.map(([kind]) => kind), text).toEqual(['move']);
    }
  });

  it('marks nothing as a branch when the option is off, whatever the text', () => {
    const text = '(a) (b2) (iii) b1) (a3) (f6)';
    expect(splitNotation(text).some(s => s.kind === 'branch')).toBe(false);
  });

  it('does not change what is marked as a move in text that has no labels', () => {
    const text = 'I played Nf3, then 9...Bxd2+ 10. Nxd2 and (Nc3) or a4.';
    expect(splitNotation(text, AUTHOR)).toEqual(splitNotation(text, {}));
  });
});

describe('branch labels — the segments', () => {
  const samples = [
    '(a3) 17... Nxe5 18. dxe5',
    'In (a) Nf3, (b) d4; (a1), (a2), (b21).',
    'b1) 17... Nxe5\nb2) 17... Nxe4',
    '  a) first\n  b) second',
    '(a)(b)(c)',
    'no labels at all, just Nf3 and e4',
    '',
    '(a3)',
    'ends with (a3)',
    '**bold (a3)** and (f6)',
    'move(s) and (aa) and (A3)',
    'line one\n\n(a)\n(b2)\n',
  ];

  it('gives back exactly the text it was given, in order', () => {
    for (const text of samples) {
      expect(splitNotation(text, AUTHOR).map(s => s.text).join(''), JSON.stringify(text)).toBe(text);
    }
  });

  it('never returns an empty segment', () => {
    for (const text of samples) {
      expect(splitNotation(text, AUTHOR).every(s => s.text.length > 0), JSON.stringify(text)).toBe(true);
    }
  });

  it('marks a label as a branch segment of its own', () => {
    expect(splitNotation('Try (a3) now', AUTHOR)).toEqual([
      { text: 'Try ', kind: 'text' },
      { text: '(a3)', kind: 'branch' },
      { text: ' now', kind: 'text' },
    ]);
  });

  it('keeps the indentation before a line-start label as ordinary text', () => {
    expect(splitNotation('  b1) go', AUTHOR)).toEqual([
      { text: '  ', kind: 'text' },
      { text: 'b1)', kind: 'branch' },
      { text: ' go', kind: 'text' },
    ]);
  });

  it('can be called repeatedly with the same results (no state carried between calls)', () => {
    const text = '(a) Nf3, (a1) d4, b1) e4';
    expect(splitNotation(text, AUTHOR)).toEqual(splitNotation(text, AUTHOR));
    expect(labels(text)).toEqual(labels(text));
  });

  it('copes with a long text of nothing but labels, and of near-labels, without slowing to a crawl', () => {
    const many = '(a1) '.repeat(20000);
    const near = '(a'.repeat(20000) + '3)'.repeat(20000);
    for (const text of [many, near, '\n'.repeat(20000) + 'b1)']) {
      const start = performance.now();
      splitNotation(text, AUTHOR);
      expect(performance.now() - start).toBeLessThan(1500);
    }
  });
});
