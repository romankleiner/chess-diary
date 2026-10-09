import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@vercel/blob', () => ({ head: vi.fn(), put: vi.fn(), list: vi.fn(), del: vi.fn() }));
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { head, put } from '@vercel/blob';
import { findCachedBoardImage, generateBoardImage, getCachedBoardImage } from '@/lib/board-image-storage';
import { boardCacheKey, parseBoardImageRequest, type BoardImageRequest } from '@/lib/board-image-request';

const mockHead = vi.mocked(head);
const mockPut  = vi.mocked(put);

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const request = (fen = START, pov = 'white') => parseBoardImageRequest(fen, pov) as BoardImageRequest;
const STORED = 'https://store.example/boards/x-white.png';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

beforeEach(() => {
  vi.resetAllMocks();
  fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => png });
  mockPut.mockResolvedValue({ url: STORED } as never);
});

describe('findCachedBoardImage', () => {
  it('gives the stored image’s address', async () => {
    mockHead.mockResolvedValue({ url: STORED } as never);
    expect(await findCachedBoardImage(request())).toBe(STORED);
    expect(mockHead).toHaveBeenCalledWith(boardCacheKey(request()), expect.anything());
  });

  it('gives nothing when it is not stored (the store throws for that)', async () => {
    mockHead.mockRejectedValue(new Error('BlobNotFoundError'));
    expect(await findCachedBoardImage(request())).toBeNull();
  });

  it('gives nothing for an empty answer', async () => {
    mockHead.mockResolvedValue(null as never);
    expect(await findCachedBoardImage(request())).toBeNull();
  });

  it('never makes or stores anything', async () => {
    mockHead.mockRejectedValue(new Error('BlobNotFoundError'));
    await findCachedBoardImage(request());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('generateBoardImage', () => {
  it('has the image service draw the checked position, from the asked side', async () => {
    await generateBoardImage(request(START, 'black'));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://fen2image.chessvision.ai/rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR?turn=white&pov=black',
      { redirect: 'follow' },
    );
  });

  it('stores it publicly as a PNG under the position’s key, and gives its address', async () => {
    expect(await generateBoardImage(request())).toBe(STORED);
    expect(mockPut).toHaveBeenCalledWith(boardCacheKey(request()), png, expect.objectContaining({
      access: 'public', contentType: 'image/png', allowOverwrite: true,
    }));
  });

  it('stores nothing, and fails, when the image service fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable' });
    await expect(generateBoardImage(request())).rejects.toThrow('503');
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('getCachedBoardImage (for the export)', () => {
  it('gives a stored image without making one', async () => {
    mockHead.mockResolvedValue({ url: STORED } as never);
    expect(await getCachedBoardImage(START, 'white')).toBe(STORED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('makes and stores one that is not stored yet', async () => {
    mockHead.mockRejectedValue(new Error('BlobNotFoundError'));
    expect(await getCachedBoardImage(START, 'black')).toBe(STORED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith(boardCacheKey(request(START, 'black')), png, expect.anything());
  });

  it('draws from White’s side unless told otherwise', async () => {
    mockHead.mockRejectedValue(new Error('BlobNotFoundError'));
    await getCachedBoardImage(START);
    expect(fetchMock.mock.calls[0][0]).toContain('pov=white');
  });

  it('refuses a position that isn’t one, before touching the store', async () => {
    await expect(getCachedBoardImage('not a position')).rejects.toThrow('valid');
    expect(mockHead).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
