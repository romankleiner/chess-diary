import { describe, it, expect } from 'vitest';
import { buildAnalysisPrompt } from '@/lib/analysis-prompt';

// ─── helpers ──────────────────────────────────────────────────────────────────

const SAMPLE_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

// ─── basic structure ──────────────────────────────────────────────────────────

describe('buildAnalysisPrompt — basic structure', () => {
  it('always opens with the chess analysis preamble', () => {
    const prompt = buildAnalysisPrompt('I liked e4', null, null, null);
    expect(prompt).toContain("You are analyzing a chess player's thought process");
  });

  it('includes the player thinking verbatim', () => {
    const prompt = buildAnalysisPrompt('Knight to f3 looks good', null, null, null);
    expect(prompt).toContain('"Knight to f3 looks good"');
  });

  it('includes FEN when provided', () => {
    const prompt = buildAnalysisPrompt('thinking', null, SAMPLE_FEN, null);
    expect(prompt).toContain(SAMPLE_FEN);
  });

  it('shows "Not available" when FEN is null', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, null);
    expect(prompt).toContain('Position (FEN): Not available');
  });

  it('shows "Not available" when FEN is undefined', () => {
    const prompt = buildAnalysisPrompt('thinking', undefined, undefined, null);
    expect(prompt).toContain('Position (FEN): Not available');
  });
});

// ─── move played ──────────────────────────────────────────────────────────────

describe('buildAnalysisPrompt — move played', () => {
  it('includes move played when provided', () => {
    const prompt = buildAnalysisPrompt('I liked it', 'Nf3', null, null);
    expect(prompt).toContain('Move played: Nf3');
  });

  it('omits move played line when null', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, null);
    expect(prompt).not.toContain('Move played:');
  });

  it('omits move played line when undefined', () => {
    const prompt = buildAnalysisPrompt('thinking', undefined, null, null);
    expect(prompt).not.toContain('Move played:');
  });
});

// ─── pgn context ─────────────────────────────────────────────────────────────

describe('buildAnalysisPrompt — pgn moves context', () => {
  it('includes pgn moves section when non-empty', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, null, 'detailed', '1. e4 e5 2. Nf3');
    expect(prompt).toContain('Game moves so far:');
    expect(prompt).toContain('1. e4 e5 2. Nf3');
  });

  it('omits pgn moves section when empty string (default)', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, null);
    expect(prompt).not.toContain('Game moves so far:');
  });
});

// ─── engine analysis block ────────────────────────────────────────────────────

describe('buildAnalysisPrompt — engine analysis', () => {
  it('omits engine analysis block when moveAnalysis is null', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, null);
    expect(prompt).not.toContain('Engine analysis:');
  });

  it('includes evaluation when provided', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, {
      evaluation: 1.25,
      bestMove: 'e2e4',
    });
    expect(prompt).toContain('Position evaluation: +1.25 pawns');
  });

  it('omits + sign for negative evaluation', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, {
      evaluation: -0.5,
      bestMove: 'e2e4',
    });
    expect(prompt).toContain('-0.50 pawns');
    expect(prompt).not.toContain('+-0.50');
  });

  it('includes best move when provided', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, {
      evaluation: 0,
      bestMove: 'Nf3',
    });
    expect(prompt).toContain("Engine's best move: Nf3");
  });

  it('includes principal variation from array', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, {
      evaluation: 0,
      bestMove: 'Nf3',
      principalVariation: ['Nf3', 'Nc6', 'Bb5'],
    });
    expect(prompt).toContain("Engine's main line: Nf3 Nc6 Bb5");
  });

  it('includes principal variation from string', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, {
      evaluation: 0,
      bestMove: 'Nf3',
      principalVariation: 'Nf3 Nc6 Bb5',
    });
    expect(prompt).toContain("Engine's main line: Nf3 Nc6 Bb5");
  });

  it('omits main line when principalVariation is empty array', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, {
      evaluation: 0,
      bestMove: 'Nf3',
      principalVariation: [],
    });
    expect(prompt).not.toContain("Engine's main line:");
  });

  it('includes centipawn loss when > 0', () => {
    const prompt = buildAnalysisPrompt('thinking', 'e4', null, {
      evaluation: 0,
      bestMove: 'Nf3',
      centipawnLoss: 150,
      moveQuality: 'mistake',
    });
    expect(prompt).toContain('1.50 pawns (mistake)');
  });

  it('omits centipawn loss when 0', () => {
    const prompt = buildAnalysisPrompt('thinking', 'e4', null, {
      evaluation: 0,
      bestMove: 'e4',
      centipawnLoss: 0,
      moveQuality: 'excellent',
    });
    expect(prompt).not.toContain('Centipawn loss');
  });

  it('includes evaluation_after with change annotation when delta > 0.03', () => {
    const prompt = buildAnalysisPrompt('thinking', 'e4', null, {
      evaluation: 0.5,
      bestMove: 'Nf3',
      evaluation_after: 0.2,
    });
    expect(prompt).toContain('Evaluation after e4');
    expect(prompt).toContain('+0.20 pawns');
    // delta = 0.2 - 0.5 = -0.3 → should include change annotation
    expect(prompt).toContain('change)');
  });

  it('omits change annotation when delta ≤ 0.03', () => {
    const prompt = buildAnalysisPrompt('thinking', 'e4', null, {
      evaluation: 0.5,
      bestMove: 'e4',
      evaluation_after: 0.52,
    });
    expect(prompt).not.toContain('change)');
  });

  it('omits evaluation_after when movePlayed is null', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, {
      evaluation: 0.5,
      bestMove: 'Nf3',
      evaluation_after: 0.2,
    });
    expect(prompt).not.toContain('Evaluation after');
  });
});

// ─── verbosity modes ──────────────────────────────────────────────────────────

describe('buildAnalysisPrompt — verbosity', () => {
  it('produces a brief instruction for verbosity "brief"', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, null, 'brief');
    expect(prompt).toContain('brief analysis (1-2 sentences)');
  });

  it('produces a detailed instruction for verbosity "detailed" (default)', () => {
    const promptDefault = buildAnalysisPrompt('thinking', null, null, null);
    const promptExplicit = buildAnalysisPrompt('thinking', null, null, null, 'detailed');
    for (const prompt of [promptDefault, promptExplicit]) {
      expect(prompt).toContain('Write 2-3 flowing paragraphs (no labels or headers)');
      expect(prompt).not.toContain('3-4 flowing paragraphs');
    }
  });

  it('produces an extensive instruction for verbosity "extensive"', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, null, 'extensive');
    expect(prompt).toContain('Write 3-4 flowing paragraphs (no labels or headers)');
    expect(prompt).not.toContain('2-3 flowing paragraphs');
  });

  it('falls back to concise for verbosity "concise"', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, null, 'concise');
    expect(prompt).toContain('concise analysis (2-3 sentences)');
  });

  it('falls back to concise for unknown verbosity values', () => {
    const prompt = buildAnalysisPrompt('thinking', null, null, null, 'ultra-verbose');
    expect(prompt).toContain('concise analysis (2-3 sentences)');
  });

  it('each verbosity mode produces a different prompt', () => {
    const brief = buildAnalysisPrompt('t', null, null, null, 'brief');
    const concise = buildAnalysisPrompt('t', null, null, null, 'concise');
    const detailed = buildAnalysisPrompt('t', null, null, null, 'detailed');
    const extensive = buildAnalysisPrompt('t', null, null, null, 'extensive');
    const prompts = new Set([brief, concise, detailed, extensive]);
    expect(prompts.size).toBe(4);
  });
});

// ─── grounding (verified position facts + line markers) ──────────────────────

describe('buildAnalysisPrompt — grounding', () => {
  const FACTS = 'Verified position facts (computed from the FEN): ...\n- Side to move: White';

  it('is unchanged when no grounding is passed', () => {
    const plain = buildAnalysisPrompt('thinking', 'Nf3', SAMPLE_FEN, null, 'detailed', '');
    expect(plain).not.toContain('Verified position facts');
    expect(plain).not.toContain('[[line:');
  });

  it('inserts the verified position facts right after the FEN', () => {
    const prompt = buildAnalysisPrompt('thinking', null, SAMPLE_FEN, null, 'detailed', '', {
      positionFacts: FACTS,
    });
    expect(prompt).toContain(FACTS);
    expect(prompt.indexOf(SAMPLE_FEN)).toBeLessThan(prompt.indexOf('Verified position facts'));
    expect(prompt.indexOf('Verified position facts')).toBeLessThan(prompt.indexOf('Player\'s thinking'));
  });

  it('asks for [[line: ...]] markers only when requested', () => {
    const without = buildAnalysisPrompt('t', null, SAMPLE_FEN, null, 'detailed', '', { positionFacts: FACTS });
    const withRules = buildAnalysisPrompt('t', null, SAMPLE_FEN, null, 'detailed', '', {
      positionFacts: FACTS,
      requestLineMarkers: true,
    });
    expect(without).not.toContain('[[line:');
    expect(withRules).toContain('[[line: Nxe5 Nxe5 d4]]');
    expect(withRules).toContain('ground truth');
  });

  it('puts the marker rules at the very end, after the verbosity instruction', () => {
    const prompt = buildAnalysisPrompt('t', null, SAMPLE_FEN, null, 'brief', '', { requestLineMarkers: true });
    expect(prompt.indexOf('Provide a brief analysis')).toBeLessThan(prompt.indexOf('Rules for concrete moves'));
  });

  it('asks for markers on opening-book moves too', () => {
    const prompt = buildAnalysisPrompt('t', 'e4', SAMPLE_FEN, { moveQuality: 'book' }, 'detailed', '', {
      requestLineMarkers: true,
    });
    expect(prompt).toContain('opening book move');
    expect(prompt).toContain('Rules for concrete moves');
  });

  describe('engine lines in SAN', () => {
    const analysis = {
      evaluation_before: 0.3,
      evaluation_after: 0.1,
      bestMove: 'f3e5',
      principalVariation: ['f3e5', 'c6e5', 'd2d4'],
      moveQuality: 'good',
    };

    it('shows the raw engine strings without grounding', () => {
      const prompt = buildAnalysisPrompt('t', 'Nf3', SAMPLE_FEN, analysis);
      expect(prompt).toContain("Engine's best move: f3e5");
      expect(prompt).toContain("Engine's main line: f3e5 c6e5 d2d4");
    });

    it('shows SAN instead when grounding provides it', () => {
      const prompt = buildAnalysisPrompt('t', 'Nf3', SAMPLE_FEN, analysis, 'detailed', '', {
        engineBestMoveSan: 'Nxe5',
        engineLineSan: '13. Nxe5 Nxe5 14. d4',
      });
      expect(prompt).toContain("Engine's best move: Nxe5");
      expect(prompt).toContain("Engine's main line: 13. Nxe5 Nxe5 14. d4");
      expect(prompt).not.toContain('f3e5');
    });

    it('falls back to the raw strings for whichever SAN is missing', () => {
      const prompt = buildAnalysisPrompt('t', 'Nf3', SAMPLE_FEN, analysis, 'detailed', '', {
        engineBestMoveSan: 'Nxe5',
      });
      expect(prompt).toContain("Engine's best move: Nxe5");
      expect(prompt).toContain("Engine's main line: f3e5 c6e5 d2d4");
    });
  });
});
