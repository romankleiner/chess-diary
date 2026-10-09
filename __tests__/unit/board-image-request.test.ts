import { describe, it, expect } from 'vitest';
import { boardCacheKey, chessvisionUrl, parseBoardImageRequest, type BoardImageRequest } from '@/lib/board-image-request';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

const ok = (fen: string | null, pov: string | null = null) => {
  const r = parseBoardImageRequest(fen, pov);
  if ('error' in r) throw new Error(`expected a request, got: ${r.error}`);
  return r;
};

describe('parseBoardImageRequest — the position', () => {
  it('reads a full position', () => {
    expect(ok(START)).toEqual({
      fen: START, fen4: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
      placement: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', turn: 'w', pov: 'white',
    });
  });

  it('reads whose move it is', () => {
    expect(ok(AFTER_E4)).toMatchObject({ turn: 'b', fen4: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3' });
  });

  it('fills in move counters a journal position left off', () => {
    expect(ok('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -').fen).toBe(START);
    expect(ok('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0').fen).toBe(START);
  });

  it('ignores spaces round it and between fields', () => {
    expect(ok(`  ${START.replace(/ /g, '   ')}  `).fen).toBe(START);
  });

  it('refuses anything over 100 characters, even a real position padded out', () => {
    const padded = START.replace(/ /g, ' '.repeat(12));
    expect(padded.length).toBeGreaterThan(100);
    expect(parseBoardImageRequest(padded, 'white')).toEqual({ error: 'A valid fen is required' });
  });

  it.each([
    ['nothing', null],
    ['an empty string', ''],
    ['words', 'hello world'],
    ['too few fields', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'],
    ['too many fields', `${START} extra`],
    ['a board with no kings', '8/8/8/8/8/8/8/8 w - - 0 1'],
    ['a board with too many squares in a rank', 'rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
    ['an impossible side to move', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1'],
    ['something far too long', 'r'.repeat(101)],
  ])('refuses %s', (_name, fen) => {
    expect(parseBoardImageRequest(fen, 'white')).toHaveProperty('error');
  });

  it.each([
    ['a path out of the image service', '../../admin/8/8/8/8/8/8/8 w - - 0 1'],
    ['a query of its own', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR?x=1 w KQkq - 0 1'],
    ['another host', 'https://evil.example/ w - - 0 1'],
    ['markup', '<script>alert(1)</script> w - - 0 1'],
    ['an encoded slash', 'rnbqkbnr%2Fpppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ])('refuses %s, which could otherwise steer the image service', (_name, fen) => {
    expect(parseBoardImageRequest(fen, 'white')).toHaveProperty('error');
  });
});

describe('parseBoardImageRequest — the side', () => {
  it('draws from White’s side unless told otherwise', () => {
    expect(ok(START, null).pov).toBe('white');
    expect(ok(START, '').pov).toBe('white');
  });

  it('takes white or black', () => {
    expect(ok(START, 'white').pov).toBe('white');
    expect(ok(START, 'black').pov).toBe('black');
  });

  it.each(['Black', 'WHITE', 'both', 'black&x=1', 'white ', '../x', 'red'])('refuses "%s"', pov => {
    expect(parseBoardImageRequest(START, pov)).toEqual({ error: 'pov must be white or black' });
  });
});

describe('boardCacheKey', () => {
  // How the store has always keyed images, so ones already stored are still found
  const oldKey = (fen: string, pov: string) => {
    const parts = fen.trim().split(/\s+/);
    return `boards/${Buffer.from(parts.slice(0, 4).join(' ')).toString('base64').replace(/\//g, '_')}-${pov}.png`;
  };

  it.each([START, AFTER_E4, 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'])('keeps the key the store already uses for %s', fen => {
    for (const pov of ['white', 'black'] as const) {
      expect(boardCacheKey(ok(fen, pov))).toBe(oldKey(fen, pov));
    }
  });

  it('gives the same key with or without move counters, so one position is one image', () => {
    expect(boardCacheKey(ok(START))).toBe(boardCacheKey(ok('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')));
  });

  it('gives each side its own image', () => {
    expect(boardCacheKey(ok(START, 'white'))).not.toBe(boardCacheKey(ok(START, 'black')));
  });

  it('stays inside the boards/ folder, with no slashes from the position', () => {
    const key = boardCacheKey(ok(START));
    expect(key.startsWith('boards/')).toBe(true);
    expect(key.slice('boards/'.length)).not.toContain('/');
  });
});

describe('chessvisionUrl', () => {
  it('asks the image service for the checked placement, the side to move and the side to view from', () => {
    expect(chessvisionUrl(ok(AFTER_E4, 'black'))).toBe(
      'https://fen2image.chessvision.ai/rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR?turn=black&pov=black',
    );
    expect(chessvisionUrl(ok(START))).toBe('https://fen2image.chessvision.ai/rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR?turn=white&pov=white');
  });

  it('always stays on the image service', () => {
    for (const fen of [START, AFTER_E4]) expect(new URL(chessvisionUrl(ok(fen))).host).toBe('fen2image.chessvision.ai');
  });
});

describe('chessvisionUrl — only from a checked request', () => {
  it('builds the address from the request’s own fields, nothing else', () => {
    const r: Pick<BoardImageRequest, 'placement' | 'turn' | 'pov'> = { placement: '8/8/8/8/8/8/8/K6k', turn: 'b', pov: 'white' };
    expect(chessvisionUrl(r)).toBe('https://fen2image.chessvision.ai/8/8/8/8/8/8/8/K6k?turn=black&pov=white');
  });
});
