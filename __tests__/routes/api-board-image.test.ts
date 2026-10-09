import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/board-image-storage', () => ({ findCachedBoardImage: vi.fn(), generateBoardImage: vi.fn() }));

import { GET } from '@/app/api/board-image/route';
import { findCachedBoardImage, generateBoardImage } from '@/lib/board-image-storage';
import { auth } from '@clerk/nextjs/server';

const mockFind     = vi.mocked(findCachedBoardImage);
const mockGenerate = vi.mocked(generateBoardImage);
const mockAuth     = vi.mocked(auth);

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const STORED = 'https://store.example/boards/x-white.png';
const MADE = 'https://store.example/boards/y-white.png';

let nextIp = 1;
/** A request from its own address, unless one is given (the rate limit is per address). */
const get = (query: Record<string, string>, ip = `198.51.100.${nextIp++ % 250}`) =>
  GET(new NextRequest(`http://localhost/api/board-image?${new URLSearchParams(query)}`, { headers: { 'x-real-ip': ip } }));

const signedOut = () => mockAuth.mockResolvedValue({ userId: null } as never);
const signedIn = () => mockAuth.mockResolvedValue({ userId: 'alice' } as never);

beforeEach(() => {
  vi.resetAllMocks();
  signedOut();
  mockFind.mockResolvedValue(null);
  mockGenerate.mockResolvedValue(MADE);
});

describe('GET /api/board-image — what it accepts', () => {
  it('refuses something that isn’t a position, before touching the store', async () => {
    for (const fen of ['', 'not a fen', '../../etc w - - 0 1', '8/8/8/8/8/8/8/8 w - - 0 1']) {
      const res = await get({ fen, pov: 'white' });
      expect(res.status, fen).toBe(400);
    }
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('refuses a side that isn’t white or black', async () => {
    const res = await get({ fen: START, pov: 'sideways' });
    expect(res.status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('refuses without a position at all', async () => {
    expect((await GET(new NextRequest('http://localhost/api/board-image'))).status).toBe(400);
  });

  it('is not cached when refused', async () => {
    expect((await get({ fen: 'nope' })).headers.get('cache-control')).toBe('no-store');
  });
});

describe('GET /api/board-image — a reader who is not signed in', () => {
  it('is sent to the stored image, which the CDN may keep', async () => {
    mockFind.mockResolvedValue(STORED);
    const res = await get({ fen: START, pov: 'white' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(STORED);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600');
  });

  it('never makes a new image: for one not stored, the browser is sent to the image service itself', async () => {
    const res = await get({ fen: START, pov: 'black' });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://fen2image.chessvision.ai/rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR?turn=white&pov=black');
  });

  it('does not let the CDN keep that, so the author’s next look can make the real image', async () => {
    expect((await get({ fen: START })).headers.get('cache-control')).toBe('no-store');
  });

  it('sends the browser to the image service if the store cannot be asked', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFind.mockRejectedValue(new Error('store down'));
    const res = await get({ fen: START });
    expect(res.headers.get('location')).toContain('https://fen2image.chessvision.ai/');
    log.mockRestore();
  });

  it('is limited to 120 a minute per address, then told to wait', async () => {
    const ip = '203.0.113.99';
    for (let i = 0; i < 120; i++) expect((await get({ fen: START }, ip)).status).toBe(307);
    const limited = await get({ fen: START }, ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect(mockFind).toHaveBeenCalledTimes(120);   // the 121st didn’t reach the store
  });

  it('counts each address on its own', async () => {
    for (let i = 0; i < 121; i++) await get({ fen: START }, '203.0.113.100');
    expect((await get({ fen: START }, '203.0.113.101')).status).toBe(307);
  });
});

describe('GET /api/board-image — the signed-in author', () => {
  beforeEach(() => signedIn());

  it('is sent to the stored image when there is one, without making another', async () => {
    mockFind.mockResolvedValue(STORED);
    const res = await get({ fen: START });
    expect(res.headers.get('location')).toBe(STORED);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('makes and stores the image when it isn’t stored yet, and is sent to it', async () => {
    const res = await get({ fen: START, pov: 'black' });
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ fen: START, pov: 'black' }));
    expect(res.headers.get('location')).toBe(MADE);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600');
  });

  it('sends the browser to the image service, uncached, when storing the image fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGenerate.mockRejectedValue(new Error('store full'));
    const res = await get({ fen: START });
    expect(res.headers.get('location')).toContain('https://fen2image.chessvision.ai/');
    expect(res.headers.get('cache-control')).toBe('no-store');
    log.mockRestore();
  });

  it('is not rate limited', async () => {
    const ip = '203.0.113.200';
    for (let i = 0; i < 130; i++) expect((await get({ fen: START }, ip)).status).toBe(307);
  });

  it('still has its request checked', async () => {
    expect((await get({ fen: 'not a fen' })).status).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
