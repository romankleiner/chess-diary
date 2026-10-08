import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  getBlogVisits: vi.fn(),
  getGamesById: vi.fn(),
  rotateDirectoryKey: vi.fn(),
}));
vi.mock('@/lib/blog-visits-server', () => ({ visitLoggingOn: vi.fn(() => true) }));

import { GET } from '@/app/api/blog-visits/route';
import { POST as rotate } from '@/app/api/blog-directory/key/route';
import { getBlogVisits, getGamesById, rotateDirectoryKey } from '@/lib/db';
import { visitLoggingOn } from '@/lib/blog-visits-server';
import { auth } from '@clerk/nextjs/server';

const mockVisits = vi.mocked(getBlogVisits);
const mockGames  = vi.mocked(getGamesById);
const mockRotate = vi.mocked(rotateDirectoryKey);
const mockOn     = vi.mocked(visitLoggingOn);
const mockAuth   = vi.mocked(auth);

const visit = (over: Record<string, unknown> = {}) => ({
  at: '2026-10-08T10:00:00.000Z', page: 'game', gameId: '111', viewer: 'visitor',
  ip: '203.0.113.7', city: null, region: null, country: 'GB', userAgent: 'x', referrer: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ userId: 'alice' } as never);
  mockVisits.mockResolvedValue([]);
  mockGames.mockResolvedValue({});
  mockOn.mockReturnValue(true);
});

describe('GET /api/blog-visits', () => {
  it('refuses someone who is not signed in', async () => {
    mockAuth.mockResolvedValue({ userId: null } as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockVisits).not.toHaveBeenCalled();
  });

  it('gives the signed-in author their own log only', async () => {
    mockVisits.mockResolvedValue([visit()]);
    const body = await (await GET()).json();
    expect(mockVisits).toHaveBeenCalledWith('alice');
    expect(body.visits).toHaveLength(1);
  });

  it('names each game in the log, reading only those games and only the author’s', async () => {
    mockVisits.mockResolvedValue([visit({ gameId: '111' }), visit({ gameId: '222' }), visit({ gameId: '111' }), visit({ page: 'directory', gameId: null })]);
    mockGames.mockResolvedValue({
      '111': { white: 'romank66', black: 'opp_a' } as never,
      '222': { white: 'opp_b', black: 'romank66' } as never,
    });
    const body = await (await GET()).json();
    expect(mockGames).toHaveBeenCalledWith(['111', '222'], 'alice');
    expect(body.gameNames).toEqual({ '111': 'romank66 vs opp_a', '222': 'opp_b vs romank66' });
  });

  it('leaves out a stored record that is not a visit', async () => {
    mockVisits.mockResolvedValue([visit(), { nonsense: true }, 'x', null, visit({ page: 'admin' })]);
    const body = await (await GET()).json();
    expect(body.visits).toHaveLength(1);
  });

  it('says whether this deployment records visits', async () => {
    mockOn.mockReturnValue(false);
    expect((await (await GET()).json()).recording).toBe(false);
    mockOn.mockReturnValue(true);
    expect((await (await GET()).json()).recording).toBe(true);
  });

  it('answers 500, without the details, when the log cannot be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockVisits.mockRejectedValue(new Error('redis down'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('redis down');
    log.mockRestore();
  });
});

describe('POST /api/blog-directory/key', () => {
  it('refuses someone who is not signed in', async () => {
    mockAuth.mockResolvedValue({ userId: null } as never);
    const res = await rotate();
    expect(res.status).toBe(401);
    expect(mockRotate).not.toHaveBeenCalled();
  });

  it('replaces the signed-in author’s own key and returns the new one', async () => {
    mockRotate.mockResolvedValue('NewKeyNewKeyNewKeyNew_');
    const res = await rotate();
    expect(res.status).toBe(200);
    expect(mockRotate).toHaveBeenCalledWith('alice');
    expect(await res.json()).toEqual({ key: 'NewKeyNewKeyNewKeyNew_' });
  });

  it('answers 500 when the key cannot be replaced', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRotate.mockRejectedValue(new Error('redis down'));
    const res = await rotate();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('redis down');
    log.mockRestore();
  });
});
