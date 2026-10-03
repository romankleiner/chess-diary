import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GameWalkthrough,
  SectionBody,
  ThinkingBlock,
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
  renderToStaticMarkup(<SectionBody section={s} phase={phase} onShowAnalysis={() => {}} />);

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

  it.each<SectionPhase>(['thinking_shown', 'solved_blind', 'complete'])('shows the thinking once revealed (%s)', phase => {
    const html = body(section(), phase);
    expect(html).toContain('My thinking');
    expect(html).toContain('Going for the Ruy Lopez.');
  });

  it('keeps paragraph breaks and **bold** in the thinking', () => {
    const html = body(section({ thinking: 'First idea.\n\nThe **key** point.' }), 'thinking_shown');

    expect(html).toContain('<p class="">First idea.</p>');
    expect(html).toContain('<p class="">The <strong>key</strong> point.</p>');
  });

  it('names the move played in the footer after a correct blind guess', () => {
    const html = body(section(), 'solved_blind');

    expect(html).toContain('Move played:');
    expect(html).toContain('Bb5');
    expect(html.indexOf('Going for the Ruy Lopez.')).toBeLessThan(html.indexOf('Move played:'));
  });

  it('does not give away the move while the thinking is shown but the guess is still open', () => {
    expect(body(section(), 'thinking_shown')).not.toContain('Move played');
  });

  it('drops the footer once the full analysis is open', () => {
    expect(body(section(), 'complete')).not.toContain('Move played');
  });

  it('has no footer for an entry that recorded no move', () => {
    expect(body(section({ moveNotation: null }), 'solved_blind')).not.toContain('Move played');
  });

  it('offers the post-game analysis after a blind solve', () => {
    expect(body(section(), 'solved_blind')).toContain('Show post-game analysis');
  });

  it('still shows the AI commentary and post-game review in the complete view', () => {
    const html = body(section({ aiReview: 'A principled choice.', postReview: 'Happy with this.' }), 'complete');

    expect(html).toContain('AI analysis');
    expect(html).toContain('A principled choice.');
    expect(html).toContain('My post-game analysis');
    expect(html).toContain('Happy with this.');
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
