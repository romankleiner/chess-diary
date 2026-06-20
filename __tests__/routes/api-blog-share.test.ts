import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { gameA } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getGame: vi.fn(),
  publishBlog: vi.fn(),
  unpublishBlog: vi.fn(),
}));

import { POST, DELETE } from '@/app/api/games/[id]/share/route';
import { getGame, publishBlog, unpublishBlog } from '@/lib/db';

const mockGetGame       = vi.mocked(getGame);
const mockPublishBlog   = vi.mocked(publishBlog);
const mockUnpublishBlog = vi.mocked(unpublishBlog);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(method: 'POST' | 'DELETE', gameId = gameA.id) {
  return new NextRequest(`http://localhost/api/games/${gameId}/share`, { method });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/games/[id]/share', () => {
  it('publishes the game when it exists for the caller', async () => {
    mockGetGame.mockResolvedValue(gameA);
    const res = await POST(makeReq('POST'), params(gameA.id));
    expect(res.status).toBe(200);
    expect((await res.json()).shared).toBe(true);
    expect(mockPublishBlog).toHaveBeenCalledWith(gameA.id);
  });

  it('returns 404 and does not publish when the caller does not own the game', async () => {
    mockGetGame.mockResolvedValue(null);
    const res = await POST(makeReq('POST'), params('ghost-id'));
    expect(res.status).toBe(404);
    expect(mockPublishBlog).not.toHaveBeenCalled();
  });

  it('returns 500 when publishing throws', async () => {
    mockGetGame.mockResolvedValue(gameA);
    mockPublishBlog.mockRejectedValue(new Error('redis down'));
    const res = await POST(makeReq('POST'), params(gameA.id));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/games/[id]/share', () => {
  it('un-shares the game', async () => {
    const res = await DELETE(makeReq('DELETE'), params(gameA.id));
    expect(res.status).toBe(200);
    expect((await res.json()).shared).toBe(false);
    expect(mockUnpublishBlog).toHaveBeenCalledWith(gameA.id);
  });
});
