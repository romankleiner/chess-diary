import { describe, it, expect, vi } from 'vitest';
import { compareGuess, fetchGuessEval, playerPawns, rateGuess, topLinePawns } from '@/lib/guess-eval';
import { formatPawns } from '@/lib/position-eval';
import type { PositionEval } from '@/lib/position-eval';

const ev = (pawns: number, mate: number | null = null): PositionEval => ({ pawns, mate, depth: 12 });
const WHITE_MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ─── point of view ────────────────────────────────────────────────────────────

describe('playerPawns', () => {
  it('keeps White’s evaluation for White and flips it for Black', () => {
    expect(playerPawns(1.5, 'white')).toBe(1.5);
    expect(playerPawns(1.5, 'black')).toBe(-1.5);
    expect(playerPawns(-0.4, 'black')).toBe(0.4);
  });
});

describe('topLinePawns', () => {
  it('adds the centipawn loss for White: the top line is better for White', () => {
    expect(topLinePawns({ evaluation: 0.2, centipawnLoss: 80 }, 'white')).toBeCloseTo(1.0);
  });

  it('subtracts it for Black: better for Black means lower for White', () => {
    expect(topLinePawns({ evaluation: -0.2, centipawnLoss: 80 }, 'black')).toBeCloseTo(-1.0);
  });

  it('is my move’s evaluation when I played the best move', () => {
    expect(topLinePawns({ evaluation: 0.7, centipawnLoss: 0 }, 'white')).toBe(0.7);
    expect(topLinePawns({ evaluation: -0.7, centipawnLoss: 0 }, 'black')).toBe(-0.7);
  });

  it('never goes beyond the mate score', () => {
    expect(topLinePawns({ evaluation: 99.5, centipawnLoss: 300 }, 'white')).toBe(100);
    expect(topLinePawns({ evaluation: -99.5, centipawnLoss: 300 }, 'black')).toBe(-100);
  });
});

// ─── comparing a guess ────────────────────────────────────────────────────────

describe('compareGuess — against the engine’s top line', () => {
  it('reports the shortfall as pawns behind the top line', () => {
    const c = compareGuess({ guess: ev(0.4), mine: 0.8, top: 1.0, color: 'white' });
    expect(c.lossVsTop).toBe(0.6);
    expect(c.headline).toBe("0.6 behind the engine's top line");
  });

  it('says the guess matches the top line when they are level', () => {
    const c = compareGuess({ guess: ev(1.0), mine: 0.8, top: 1.0, color: 'white' });
    expect(c.lossVsTop).toBe(0);
    expect(c.headline).toBe("Matches the engine's top line");
  });

  it('says "at least as good" when the guess beats the stored top line, as a deeper search can', () => {
    const c = compareGuess({ guess: ev(1.4), mine: 0.8, top: 1.0, color: 'white' });
    expect(c.lossVsTop).toBe(0);
    expect(c.headline).toBe("At least as good as the engine's top line");
  });

  it('works from Black’s point of view: a lower White evaluation is better', () => {
    // White-POV: guess -0.4, top -1.0. For Black that's +0.4 against +1.0: 0.6 short.
    const c = compareGuess({ guess: ev(-0.4), mine: -0.8, top: -1.0, color: 'black' });
    expect(c).toMatchObject({ guess: 0.4, mine: 0.8, top: 1.0, lossVsTop: 0.6 });
    expect(c.headline).toBe("0.6 behind the engine's top line");
  });

  it('rounds everything to a tenth, like the engine check beside it', () => {
    const c = compareGuess({ guess: ev(0.349), mine: 0.851, top: 1.049, color: 'white' });
    expect(c).toMatchObject({ guess: 0.3, mine: 0.9, top: 1.0 });
  });

  it('rounds exactly as the printed numbers do, even at awkward half-way values', () => {
    // 0.35 prints as 0.3 and 1.25 as 1.3 -- the comparison must use what is printed.
    const c = compareGuess({ guess: ev(0.35), mine: 1.25, top: 1.25, color: 'white' });
    expect(c.guess).toBe(Number(formatPawns(0.35)));
    expect(c.mine).toBe(Number(formatPawns(1.25)));
    expect(c.lossVsTop).toBe(1.0); // 1.3 - 0.3, as the reader would work it out from the page
    expect(c.headline).toBe("1.0 behind the engine's top line");
  });

  it('rounds the same whichever colour the reader plays', () => {
    // The same 1.25-pawn deficit, seen from White's side and from Black's.
    const asWhite = compareGuess({ guess: ev(-1.25), mine: 0, top: 0, color: 'white' });
    const asBlack = compareGuess({ guess: ev(1.25), mine: 0, top: 0, color: 'black' });
    expect(asWhite.guess).toBe(-1.3);
    expect(asBlack.guess).toBe(-1.3);
  });

  it('measures the shortfall between the rounded numbers, so the sentence matches what is printed', () => {
    // 1.04 and 0.96 print as 1.0 and 1.0: no shortfall to talk about.
    const c = compareGuess({ guess: ev(0.96), mine: 1.0, top: 1.04, color: 'white' });
    expect(c.lossVsTop).toBe(0);
    expect(c.headline).toBe("Matches the engine's top line");
  });

  it('grades the guess with the same labels as my own moves', () => {
    // Shortfalls are whole tenths of a pawn once rounded, so the label boundaries
    // (25 / 50 / 100 / 200 centipawns) fall between 0.2|0.3, 0.5|0.6, 1.0|1.1, 2.0|2.1.
    const q = (guess: number) => compareGuess({ guess: ev(guess), mine: 0, top: 1.0, color: 'white' }).quality;
    expect(q(1.0)).toBe('excellent'); // 0.0 short
    expect(q(0.8)).toBe('excellent'); // 0.2 short
    expect(q(0.7)).toBe('good'); // 0.3 short
    expect(q(0.5)).toBe('good'); // 0.5 short
    expect(q(0.4)).toBe('inaccuracy'); // 0.6 short
    expect(q(0.0)).toBe('inaccuracy'); // 1.0 short
    expect(q(-0.1)).toBe('mistake'); // 1.1 short
    expect(q(-1.0)).toBe('mistake'); // 2.0 short
    expect(q(-1.1)).toBe('blunder'); // 2.1 short
  });

  it('does not count a guess better than the top line as a loss', () => {
    expect(compareGuess({ guess: ev(3.0), mine: 0, top: 1.0, color: 'white' }).quality).toBe('excellent');
  });
});

describe('compareGuess — against my move', () => {
  it('says better, by how much', () => {
    const c = compareGuess({ guess: ev(1.0), mine: 0.4, top: 1.0, color: 'white' });
    expect(c.versusMine).toBe('Better than my move by 0.6');
  });

  it('says worse, by how much', () => {
    const c = compareGuess({ guess: ev(0.1), mine: 0.8, top: 1.0, color: 'white' });
    expect(c.versusMine).toBe('Worse than my move by 0.7');
  });

  it('calls a difference of a tenth or less "about the same", since engines wobble that much between runs', () => {
    const same = (guess: number) => compareGuess({ guess: ev(guess), mine: 0.5, top: 1.0, color: 'white' }).versusMine;
    expect(same(0.5)).toBe('About the same as my move');
    expect(same(0.6)).toBe('About the same as my move');
    expect(same(0.4)).toBe('About the same as my move');
    expect(same(0.7)).toBe('Better than my move by 0.2');
    expect(same(0.3)).toBe('Worse than my move by 0.2');
  });

  it('works from Black’s point of view', () => {
    // Black: guess +0.9, mine +0.3 (White-POV -0.9 and -0.3).
    const c = compareGuess({ guess: ev(-0.9), mine: -0.3, top: -1.0, color: 'black' });
    expect(c.versusMine).toBe('Better than my move by 0.6');
  });
});

describe('compareGuess — forced mates', () => {
  it('celebrates finding the mate the engine found', () => {
    const c = compareGuess({ guess: ev(100, 3), mine: 100, top: 100, color: 'white' });
    expect(c.headline).toBe('Finds the forced mate');
    expect(c.versusMine).toBe('Also a forced mate, like mine');
  });

  it('credits a mate even when the stored top line did not have one', () => {
    const c = compareGuess({ guess: ev(100, 2), mine: 1.0, top: 1.5, color: 'white' });
    expect(c.headline).toBe('Finds a forced mate');
    expect(c.versusMine).toBe('Better than my move — it finds a forced mate');
    expect(c.lossVsTop).toBe(0);
  });

  it('says so when the guess misses a mate that was there', () => {
    const c = compareGuess({ guess: ev(2.0), mine: 1.0, top: 100, color: 'white' });
    expect(c.headline).toBe('Misses a forced mate');
  });

  it('says so when I had the mate and the guess did not', () => {
    const c = compareGuess({ guess: ev(2.0), mine: 100, top: 100, color: 'white' });
    expect(c.versusMine).toBe('Worse than my move — I had a forced mate');
  });

  it('warns when the guess walks into a mate', () => {
    const c = compareGuess({ guess: ev(-100, -2), mine: 0.3, top: 0.5, color: 'white' });
    expect(c.headline).toBe('Walks into a forced mate');
    expect(c.versusMine).toBe('Worse than my move — it walks into a forced mate');
    expect(c.quality).toBe('blunder');
  });

  it('does not blame the guess when the position was lost to mate whatever was played', () => {
    const c = compareGuess({ guess: ev(-100, -2), mine: -100, top: -100, color: 'white' });
    expect(c.headline).toBe('A forced mate against you either way');
    expect(c.versusMine).toBe('About the same as my move');
  });

  it('credits a guess that avoids a mate I walked into', () => {
    const c = compareGuess({ guess: ev(-0.5), mine: -100, top: -0.3, color: 'white' });
    expect(c.versusMine).toBe('Better than my move — I walked into a forced mate');
  });

  it('reads mates from Black’s side too', () => {
    // Black mates: White-POV -100.
    const c = compareGuess({ guess: ev(-100, -2), mine: -100, top: -100, color: 'black' });
    expect(c.headline).toBe('Finds the forced mate');
    expect(c).toMatchObject({ guess: 100, mine: 100, top: 100 });
  });

  it('treats a guess that mates on the spot as finding the mate', () => {
    const c = compareGuess({ guess: ev(100, 0), mine: 100, top: 100, color: 'white' });
    expect(c.headline).toBe('Finds the forced mate');
  });
});

// ─── rating a guess end to end ────────────────────────────────────────────────

describe('rateGuess', () => {
  // I played a move worth +0.8 for White that fell 0.4 short of the top line (+1.2).
  const engine = { evaluation: 0.8, centipawnLoss: 40, depth: 14 };

  it('evaluates the reader’s move live and compares it with mine and the top line', async () => {
    const fetchFn = okReply({ pawns: 0.2, mate: null, depth: 14 });
    const { guessEval, comparison } = await rateGuess({
      fenAfterGuess: START_FEN, isEngineBest: false, engine, color: 'white', fetchFn,
    });

    expect(guessEval).toEqual({ pawns: 0.2, mate: null, depth: 14 });
    expect(comparison).toMatchObject({ guess: 0.2, mine: 0.8, top: 1.2, lossVsTop: 1.0 });
    expect(comparison.headline).toBe("1.0 behind the engine's top line");
    expect(comparison.versusMine).toBe('Worse than my move by 0.6');
  });

  it('searches as deeply as the stored analysis did', async () => {
    const fetchFn = okReply({ pawns: 0.2, mate: null, depth: 14 });
    await rateGuess({ fenAfterGuess: START_FEN, isEngineBest: false, engine, color: 'white', fetchFn });
    const [url] = fetchFn.mock.calls[0] as unknown as [string];

    expect(new URL(url, 'http://x').searchParams.get('depth')).toBe('14');
  });

  it('needs no request when the guess is the engine’s own top move', async () => {
    const fetchFn = okReply({});
    const { guessEval, comparison } = await rateGuess({
      fenAfterGuess: START_FEN, isEngineBest: true, engine, color: 'white', fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(guessEval.pawns).toBeCloseTo(1.2);
    expect(comparison.headline).toBe("Matches the engine's top line");
    expect(comparison.versusMine).toBe('Better than my move by 0.4');
  });

  it('compares from Black’s side', async () => {
    // Black: my move left White on -0.8; the top line was -1.2; the guess leaves White on -0.2.
    const fetchFn = okReply({ pawns: -0.2, mate: null, depth: 14 });
    const { comparison } = await rateGuess({
      fenAfterGuess: START_FEN, isEngineBest: false, engine: { evaluation: -0.8, centipawnLoss: 40, depth: 14 }, color: 'black', fetchFn,
    });

    expect(comparison).toMatchObject({ guess: 0.2, mine: 0.8, top: 1.2, lossVsTop: 1.0 });
  });

  it('answers a guess that checkmates without any request', async () => {
    const fetchFn = okReply({});
    const { guessEval, comparison } = await rateGuess({
      fenAfterGuess: WHITE_MATED, isEngineBest: false, engine: { evaluation: 5, centipawnLoss: 0 }, color: 'black', fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(guessEval).toMatchObject({ pawns: -100, mate: 0 });
    expect(comparison.headline).toBe('Finds a forced mate');
  });

  it('fails when the evaluation cannot be fetched, so the caller can say so', async () => {
    const fetchFn = okReply({ error: 'Could not evaluate that position right now.' }, false, 502);
    await expect(rateGuess({ fenAfterGuess: START_FEN, isEngineBest: false, engine, color: 'white', fetchFn }))
      .rejects.toThrow('Could not evaluate');
  });
});

// ─── fetching ─────────────────────────────────────────────────────────────────

const okReply = (body: unknown, ok = true, status = 200) =>
  vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('fetchGuessEval', () => {
  it('asks /api/eval for the position and returns what comes back', async () => {
    const fetchFn = okReply({ pawns: 0.3, mate: null, depth: 12 });
    const result = await fetchGuessEval(START_FEN, 12, fetchFn);

    expect(result).toEqual({ pawns: 0.3, mate: null, depth: 12 });
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    const parsed = new URL(url, 'http://x');
    expect(parsed.pathname).toBe('/api/eval');
    expect(parsed.searchParams.get('fen')).toBe(START_FEN);
    expect(parsed.searchParams.get('depth')).toBe('12');
  });

  it('asks for the same depth the stored analysis used, when it is known', async () => {
    const fetchFn = okReply({ pawns: 0, mate: null, depth: 14 });
    await fetchGuessEval(START_FEN, 14, fetchFn);
    const [url] = fetchFn.mock.calls[0] as unknown as [string];

    expect(new URL(url, 'http://x').searchParams.get('depth')).toBe('14');
  });

  it('leaves depth out when it is not known, letting the server choose', async () => {
    const fetchFn = okReply({ pawns: 0, mate: null, depth: 12 });
    await fetchGuessEval(START_FEN, null, fetchFn);
    await fetchGuessEval(START_FEN, undefined, fetchFn);

    for (const [url] of fetchFn.mock.calls as unknown as Array<[string]>) {
      expect(new URL(url, 'http://x').searchParams.has('depth')).toBe(false);
    }
  });

  it('keeps a mate’s length', async () => {
    const result = await fetchGuessEval(START_FEN, 12, okReply({ pawns: 100, mate: 3, depth: 12 }));
    expect(result).toMatchObject({ pawns: 100, mate: 3 });
  });

  it('answers a finished game itself, without a request', async () => {
    const fetchFn = okReply({});
    const result = await fetchGuessEval(WHITE_MATED, 12, fetchFn);

    expect(result).toEqual({ pawns: -100, mate: 0, depth: null });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('passes on the server’s reason when it refuses', async () => {
    await expect(fetchGuessEval(START_FEN, 12, okReply({ error: 'Too many requests' }, false, 429)))
      .rejects.toThrow('Too many requests');
  });

  it('still fails clearly when the refusal has no readable body', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }) as unknown as Response) as unknown as typeof fetch;
    await expect(fetchGuessEval(START_FEN, 12, fetchFn)).rejects.toThrow('502');
  });

  it('rejects a reply that is not an evaluation', async () => {
    await expect(fetchGuessEval(START_FEN, 12, okReply({ nope: true }))).rejects.toThrow(/unreadable/);
    await expect(fetchGuessEval(START_FEN, 12, okReply(null))).rejects.toThrow(/unreadable/);
    await expect(fetchGuessEval(START_FEN, 12, okReply({ pawns: 'lots' }))).rejects.toThrow(/unreadable/);
  });

  it('passes a network failure through', async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(fetchGuessEval(START_FEN, 12, fetchFn)).rejects.toThrow('Failed to fetch');
  });
});
