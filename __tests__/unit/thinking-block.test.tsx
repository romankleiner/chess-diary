import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AiAnalysisBlock,
  GameWalkthrough,
  MoveSectionCard,
  PostGameBlock,
  SectionBody,
  ThinkingBlock,
  revealScrollBlock,
  type MoveSection,
  type SectionPhase,
} from '@/components/blog-shared';

// ─── helpers ──────────────────────────────────────────────────────────────────

const section = (over: Partial<MoveSection> = {}): MoveSection => ({
  type: 'move',
  header: 'Move 3: Bb5',
  timestamp: '2026-06-01T10:00:00.000Z',
  fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  userColor: 'white',
  thinking: 'Going for the Ruy Lopez.',
  moveNotation: 'Bb5',
  opponentLastMove: 'Nc6 (b8-c6)',
  plyIndex: 4,
  engineEval: null,
  aiReview: null,
  postReview: null,
  ...over,
});

const body = (s: MoveSection, phase: SectionPhase) =>
  renderToStaticMarkup(<SectionBody section={s} phase={phase} />);

/** Text of the first element whose markup carries `needle` in its class attribute. */
const classesOf = (html: string, needle: string) =>
  [...html.matchAll(/class="([^"]*)"/g)].map(m => m[1]).filter(c => c.includes(needle));

// ─── ThinkingBlock ────────────────────────────────────────────────────────────

describe('ThinkingBlock', () => {
  const html = renderToStaticMarkup(<ThinkingBlock><p>I liked the pin.</p></ThinkingBlock>);

  it('labels the block "My thinking" in a header strip above the text', () => {
    expect(html).toContain('My thinking');
    expect(html.indexOf('My thinking')).toBeLessThan(html.indexOf('I liked the pin.'));
  });

  it('keeps the label and the text in separate elements, so they can be styled apart', () => {
    // The label's classes (small caps, purple) must not leak onto the body text.
    const [labelClasses] = classesOf(html, 'uppercase');
    const [bodyClasses] = classesOf(html, 'leading-relaxed');

    expect(labelClasses).toContain('text-xs');
    expect(labelClasses).toContain('text-purple-700');
    expect(bodyClasses).not.toContain('uppercase');
    expect(bodyClasses).not.toContain('text-purple');
  });

  it('sets the text larger and darker than the label', () => {
    const [bodyClasses] = classesOf(html, 'leading-relaxed');

    expect(bodyClasses).toContain('text-base');
    expect(bodyClasses).toContain('text-gray-900');
    expect(bodyClasses).toContain('dark:text-gray-50');
    expect(bodyClasses).toContain('bg-white');
  });

  it('has a dark-mode treatment for every surface', () => {
    expect(html).toContain('dark:bg-gray-900'); // body
    expect(html).toContain('dark:bg-purple-900/30'); // header strip
    expect(html).toContain('dark:border-purple-800');
  });

  it('marks the decorative emoji as hidden from screen readers', () => {
    expect(html).toContain('aria-hidden="true">💭</span>');
  });

  it('uses smaller text in compact mode', () => {
    const compact = renderToStaticMarkup(<ThinkingBlock compact>x</ThinkingBlock>);
    const [bodyClasses] = classesOf(compact, 'leading-relaxed');

    expect(bodyClasses).toContain('text-sm');
    expect(bodyClasses).not.toContain('text-base');
  });

  it('renders no footer unless one is given', () => {
    expect(html).not.toContain('border-t');
  });

  it('renders the footer below the text when given', () => {
    const withFooter = renderToStaticMarkup(<ThinkingBlock footer={<>Move played: Bb5</>}>text</ThinkingBlock>);

    expect(withFooter).toContain('Move played: Bb5');
    expect(withFooter.indexOf('text')).toBeLessThan(withFooter.indexOf('Move played'));
  });
});

// ─── SectionBody ──────────────────────────────────────────────────────────────

describe('SectionBody — the thinking block', () => {
  it('shows nothing while the reader is still guessing', () => {
    expect(body(section(), 'puzzle')).toBe('');
  });

  it.each<SectionPhase>(['thinking_shown', 'complete'])('shows the thinking once revealed (%s)', phase => {
    const html = body(section(), phase);
    expect(html).toContain('My thinking');
    expect(html).toContain('Going for the Ruy Lopez.');
  });

  it('keeps paragraph breaks and **bold** in the thinking', () => {
    const html = body(section({ thinking: 'First idea.\n\nThe **key** point.' }), 'thinking_shown');

    expect(html).toContain('<p class="">First idea.</p>');
    expect(html).toContain('<p class="">The <strong>key</strong> point.</p>');
  });

  it('does not give away the move while the thinking is shown but the guess is still open', () => {
    expect(body(section(), 'thinking_shown')).not.toContain('Move played');
  });

  it('has no "move played" footer once solved: the board already shows it', () => {
    expect(body(section(), 'complete')).not.toContain('Move played');
  });
});

// ─── solving a move reveals everything ────────────────────────────────────────

describe('SectionBody — once the move is solved', () => {
  const full = section({
    engineEval: { moveQuality: 'good', centipawnLoss: 25, evaluation: 0.4, bestMoveSan: 'd4' },
    aiReview: 'A principled choice.',
    postReview: 'Happy with this.',
  });

  it('shows the thinking, engine check, AI commentary and post-game review straight away', () => {
    const html = body(full, 'complete');

    expect(html).toContain('My thinking');
    expect(html).toContain('Evaluation of the position');
    expect(html).toContain('AI analysis');
    expect(html).toContain('A principled choice.');
    expect(html).toContain('My post-game analysis');
    expect(html).toContain('Happy with this.');
  });

  it('shows them in reading order: thinking, engine check, AI, then post-game', () => {
    const html = body(full, 'complete');
    const at = (s: string) => html.indexOf(s);

    expect(at('My thinking')).toBeLessThan(at('Evaluation of the position'));
    expect(at('Evaluation of the position')).toBeLessThan(at('AI analysis'));
    expect(at('AI analysis')).toBeLessThan(at('My post-game analysis'));
  });

  it('no longer asks the reader to click for the post-game analysis', () => {
    expect(body(full, 'complete')).not.toContain('Show post-game analysis');
    expect(body(full, 'thinking_shown')).not.toContain('Show post-game analysis');
  });

  it('keeps the AI and post-game review hidden while the move is still open', () => {
    const html = body(full, 'thinking_shown');

    expect(html).toContain('My thinking');
    expect(html).not.toContain('AI analysis');
    expect(html).not.toContain('A principled choice.');
    expect(html).not.toContain('My post-game analysis');
    expect(html).not.toContain('Happy with this.');
    expect(html).not.toContain('Evaluation of the position');
  });

  it('shows only what exists: no empty AI box when there is no AI commentary', () => {
    const html = body(section({ aiReview: null, postReview: 'Happy with this.' }), 'complete');

    expect(html).not.toContain('AI analysis');
    expect(html).toContain('My post-game analysis');
  });

  it('shows no empty post-game box when there is no post-game review', () => {
    const html = body(section({ aiReview: 'A principled choice.', postReview: null }), 'complete');

    expect(html).toContain('AI analysis');
    expect(html).not.toContain('My post-game analysis');
  });

  it('shows nothing extra for an entry that has only thinking', () => {
    const html = body(section({ aiReview: null, postReview: null, engineEval: null }), 'complete');

    expect(html).toContain('My thinking');
    expect(html).not.toContain('AI analysis');
    expect(html).not.toContain('My post-game analysis');
    expect(html).not.toContain('Evaluation of the position');
  });
});

// ─── the AI and post-game boxes ───────────────────────────────────────────────

describe('AiAnalysisBlock and PostGameBlock', () => {
  const thinking = renderToStaticMarkup(<ThinkingBlock>text</ThinkingBlock>);
  const ai = renderToStaticMarkup(<AiAnalysisBlock>text</AiAnalysisBlock>);
  const post = renderToStaticMarkup(<PostGameBlock>text</PostGameBlock>);

  it('label each box in its own voice', () => {
    expect(ai).toContain('AI analysis');
    expect(ai).toContain('aria-hidden="true">🤖</span>');
    expect(post).toContain('My post-game analysis');
    expect(post).toContain('aria-hidden="true">📝</span>');
  });

  it('use the same structure as the thinking box: label strip, then a plain body', () => {
    // Same classes apart from the colours (and the label text and icon).
    const shape = (html: string) => html.replace(/(purple|cyan|amber)(-\d+)?/g, 'X').replace(/>[^<]*</g, '><');
    expect(shape(ai)).toBe(shape(thinking));
    expect(shape(post)).toBe(shape(thinking));
  });

  it('keep the label apart from the body text, as the thinking box does', () => {
    for (const html of [ai, post]) {
      const [labelClasses] = classesOf(html, 'uppercase');
      const [bodyClasses] = classesOf(html, 'leading-relaxed');

      expect(labelClasses).toContain('text-xs');
      expect(bodyClasses).not.toContain('uppercase');
      expect(bodyClasses).toContain('text-base');
      expect(bodyClasses).toContain('text-gray-900');
      expect(bodyClasses).toContain('bg-white');
    }
  });

  it('are told apart by colour: purple, cyan, amber', () => {
    expect(thinking).toContain('border-l-purple-400');
    expect(ai).toContain('border-l-cyan-400');
    expect(post).toContain('border-l-amber-400');

    expect(ai).not.toMatch(/purple|amber/);
    expect(post).not.toMatch(/purple|cyan/);
    expect(thinking).not.toMatch(/cyan|amber/);
  });

  it('have a dark-mode treatment for every coloured surface', () => {
    for (const [html, colour] of [[ai, 'cyan'], [post, 'amber']] as const) {
      expect(html).toContain(`dark:bg-${colour}-900/30`);
      expect(html).toContain(`dark:border-${colour}-800`);
      expect(html).toContain(`dark:text-${colour}-300`);
      expect(html).toContain('dark:bg-gray-900');
    }
  });

  it('use a label colour dark enough to read on the tinted strip', () => {
    expect(classesOf(ai, 'uppercase')[0]).toContain('text-cyan-800');
    expect(classesOf(post, 'uppercase')[0]).toContain('text-amber-800');
  });

  it('are not set in italics any more: the box says it is the AI', () => {
    expect(ai).not.toContain('italic');
  });

  it('support compact type and a footer, like the thinking box', () => {
    const compact = renderToStaticMarkup(<AiAnalysisBlock compact footer={<>note</>}>text</AiAnalysisBlock>);
    expect(classesOf(compact, 'leading-relaxed')[0]).toContain('text-sm');
    expect(compact).toContain('note');
  });
});

// ─── the older compact card ───────────────────────────────────────────────────

describe('MoveSectionCard — entries with no move to guess', () => {
  // With no recorded move there is no puzzle, so the card opens fully revealed.
  const html = renderToStaticMarkup(
    <MoveSectionCard section={section({
      moveNotation: null,
      thinking: 'First idea.\n\nSecond idea.',
      aiReview: 'A principled choice.',
      postReview: 'Happy with this.\n\nAnd a second thought.',
      engineEval: { moveQuality: 'good', centipawnLoss: 25, evaluation: 0.4 },
    })} />
  );

  it('shows the thinking, AI and post-game review in the same boxes', () => {
    expect(html).toContain('My thinking');
    expect(html).toContain('AI analysis');
    expect(html).toContain('My post-game analysis');
    expect(html).toContain('border-l-purple-400');
    expect(html).toContain('border-l-cyan-400');
    expect(html).toContain('border-l-amber-400');
  });

  it('keeps paragraph breaks in every box, which plain text used to lose', () => {
    expect(html).toContain('<p class="">First idea.</p><p class="">Second idea.</p>');
    expect(html).toContain('<p class="">Happy with this.</p><p class="">And a second thought.</p>');
  });

  it('shows the engine verdict at the top of the post-game box', () => {
    expect(html).toContain('+0.4');
    expect(html).toContain('· good');
    expect(html).toContain('· 25 cp');
    expect(html.indexOf('+0.4')).toBeLessThan(html.indexOf('Happy with this.'));
  });

  it('shows no unsolved-move controls', () => {
    expect(html).not.toContain('Reveal thinking');
    expect(html).not.toContain('Show post-game analysis');
  });
});

describe('MoveSectionCard — an entry with a move to guess', () => {
  const html = renderToStaticMarkup(
    <MoveSectionCard section={section({ aiReview: 'A principled choice.', postReview: 'Happy with this.' })} />
  );

  it('starts with the write-up hidden', () => {
    expect(html).toContain('Reveal thinking');
    expect(html).not.toContain('My thinking');
    expect(html).not.toContain('AI analysis');
    expect(html).not.toContain('Happy with this.');
  });
});

// ─── where to scroll after solving a move ─────────────────────────────────────

describe('revealScrollBlock', () => {
  it('scrolls only if needed when the reveal fits on screen', () => {
    expect(revealScrollBlock(300, 800)).toBe('nearest');
    expect(revealScrollBlock(600, 800)).toBe('nearest');
  });

  it('scrolls to the start of a reveal that is taller than most of the screen', () => {
    // thinking + engine check + AI + post-game on a phone
    expect(revealScrollBlock(1200, 800)).toBe('start');
    expect(revealScrollBlock(641, 455)).toBe('start');
  });

  it('switches at 85% of the viewport height', () => {
    expect(revealScrollBlock(680, 800)).toBe('nearest'); // exactly 85%
    expect(revealScrollBlock(681, 800)).toBe('start');
  });
});

// ─── the "play through" hint ──────────────────────────────────────────────────

describe('GameWalkthrough — the play-through hint', () => {
  const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6';
  const html = renderToStaticMarkup(
    <GameWalkthrough pgn={PGN} userColor="white" sections={[section(), section({ header: 'Move 6: Re1', plyIndex: 10 })]} />
  );

  it('tells the reader to play through to the next commentated move', () => {
    expect(html).toContain('Play through to my next commentated move');
  });

  it('no longer names a move number, which was confusing when it was not the next one', () => {
    expect(html).not.toContain('Play through to my move at');
  });

  it('does not show the thinking before it is revealed', () => {
    expect(html).not.toContain('My thinking');
  });
});
