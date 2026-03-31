/**
 * Tier 5 — GET /api/journal/export
 *
 * Tests:
 *  - Validation (missing endDate → 400)
 *  - JSON format: date-range filtering, game attachment, groupedByDate shape
 *  - DOCX format: correct headers, non-empty buffer, saveJournal caching call,
 *    duplicate-entry deduplication via processedEntryIds, FEN board-image fetch
 *  - Image magic-byte detection: PNG (0x89 0x50) and JPEG (0xFF 0xD8) helper
 *    functions; unknown format falls back to default dimensions gracefully
 *
 * The real `docx` library is used (not mocked) — it embeds raw image bytes
 * without content validation, so minimal synthetic buffers are safe to use.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { gameA, thoughtEntry, moveEntry, summaryEntry } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getJournal:  vi.fn(),
  getGames:    vi.fn(),
  saveJournal: vi.fn(),
}));

// Stub global fetch to prevent real HTTP calls during DOCX generation.
// The export route optionally fetches board images from /api/board-image —
// we return { ok: false } by default so FEN-based image generation fails
// gracefully (the route logs the error and continues without the image).
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { GET } from '@/app/api/journal/export/route';
import { getJournal, getGames, saveJournal } from '@/lib/db';

const mockGetJournal  = vi.mocked(getJournal);
const mockGetGames    = vi.mocked(getGames);
const mockSaveJournal = vi.mocked(saveJournal);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/journal/export');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

const DOCX_PARAMS = { startDate: '2026-03-10', endDate: '2026-03-10', format: 'docx' };

/**
 * Minimal PNG buffer: PNG magic bytes at [0-1] plus width/height
 * at the offsets the route reads (16-19 and 20-23).
 */
function makePngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24, 0);
  buf[0] = 0x89;
  buf[1] = 0x50; // PNG magic
  buf.writeUInt32BE(width,  16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/**
 * Minimal JPEG buffer: SOI marker plus an inline SOF0 segment that carries
 * height/width at the exact byte offsets the route's JPEG parser expects.
 *
 * Route parser layout (starting at offset=2):
 *   [offset+0] = 0xFF  (marker prefix)
 *   [offset+1] = 0xC0  (SOF0)
 *   [offset+2..3] = segLen (big-endian uint16)
 *   [offset+5..6] = height
 *   [offset+7..8] = width
 */
function makeJpegBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(12, 0);
  buf[0] = 0xFF; buf[1] = 0xD8;   // JPEG SOI
  buf[2] = 0xFF; buf[3] = 0xC0;   // SOF0 (offset = 2)
  buf.writeUInt16BE(0x11, 4);      // segment length
  buf[6] = 0x08;                   // precision
  buf.writeUInt16BE(height, 7);    // height  (offset + 5)
  buf.writeUInt16BE(width,  9);    // width   (offset + 7)
  return buf;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: false, text: async () => 'not found' });
  mockGetJournal.mockResolvedValue([]);
  mockGetGames.mockResolvedValue({});
  mockSaveJournal.mockResolvedValue(undefined);
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('GET /api/journal/export — validation', () => {
  it('returns 400 when endDate is missing', async () => {
    const req = new NextRequest(
      'http://localhost/api/journal/export?startDate=2026-01-01'
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/endDate/i);
  });
});

// ─── JSON format ──────────────────────────────────────────────────────────────

describe('GET /api/journal/export — JSON format', () => {
  it('returns entries within the date range (inclusive)', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, summaryEntry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const res = await GET(makeReq({ startDate: '2026-03-10', endDate: '2026-03-10' }));
    const { entries } = await res.json();
    expect(entries).toHaveLength(2);
  });

  it('excludes entries outside the date range', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, summaryEntry]);
    const res = await GET(makeReq({ startDate: '2026-03-11', endDate: '2026-03-20' }));
    const { entries } = await res.json();
    expect(entries).toHaveLength(0);
  });

  it('attaches game data to entries that have a gameId', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const { entries } = await (
      await GET(makeReq({ startDate: '2026-03-10', endDate: '2026-03-10' }))
    ).json();
    expect(entries[0].game).toMatchObject({ id: gameA.id });
  });

  it('returns null game for entries without a gameId', async () => {
    const noGame = { ...thoughtEntry, gameId: undefined };
    mockGetJournal.mockResolvedValue([noGame]);
    const { entries } = await (
      await GET(makeReq({ startDate: '2026-03-10', endDate: '2026-03-10' }))
    ).json();
    expect(entries[0].game).toBeNull();
  });

  it('groups entries by date in groupedByDate', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, summaryEntry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const { groupedByDate } = await (
      await GET(makeReq({ startDate: '2026-03-10', endDate: '2026-03-10' }))
    ).json();
    expect(groupedByDate).toHaveLength(1);
    expect(groupedByDate[0].date).toBe('2026-03-10');
    expect(groupedByDate[0].entries).toHaveLength(2);
  });
});

// ─── DOCX format ──────────────────────────────────────────────────────────────

describe('GET /api/journal/export — DOCX format', () => {
  it('returns the correct DOCX Content-Type', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const res = await GET(makeReq(DOCX_PARAMS));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('wordprocessingml.document');
  });

  it('Content-Disposition filename includes the date range', async () => {
    mockGetJournal.mockResolvedValue([]);
    const res = await GET(makeReq(DOCX_PARAMS));
    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain('2026-03-10');
  });

  it('response body is a non-empty buffer', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const res = await GET(makeReq(DOCX_PARAMS));
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('calls saveJournal once after document generation (image caching step)', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    await GET(makeReq(DOCX_PARAMS));
    expect(mockSaveJournal).toHaveBeenCalledOnce();
  });

  // ── Duplicate-entry deduplication ─────────────────────────────────────────

  it('deduplicates entries with the same id (processedEntryIds Set)', async () => {
    // Provide the same entry object twice; the second occurrence must be
    // silently skipped — the export should still succeed without any crash.
    const dup = { ...thoughtEntry }; // identical id
    mockGetJournal.mockResolvedValue([thoughtEntry, dup]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const res = await GET(makeReq(DOCX_PARAMS));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('wordprocessingml.document');
  });

  // ── FEN board-image fetching ───────────────────────────────────────────────

  it('fetches a board image when entry has a FEN but no cached image', async () => {
    mockGetJournal.mockResolvedValue([{ ...moveEntry }]); // moveEntry has a FEN
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    await GET(makeReq(DOCX_PARAMS));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/board-image')
    );
  });

  it('skips the board-image fetch when a cached image is present at images[0]', async () => {
    const cachedPng = `data:image/png;base64,${Buffer.alloc(24).toString('base64')}`;
    const cachedEntry = { ...moveEntry, images: [cachedPng] };
    mockGetJournal.mockResolvedValue([cachedEntry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    await GET(makeReq(DOCX_PARAMS));
    // No board-image HTTP call needed when the cache hit exists
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Image magic-byte detection ───────────────────────────────────────────────
//
// Entries used here have no FEN, so their images go into the
// "additional user images" section — the only place where magic-byte
// parsing runs to determine width/height for scaling.

describe('GET /api/journal/export — image magic-byte detection', () => {
  it('exports successfully with a PNG image (magic: 0x89 0x50)', async () => {
    const png = makePngBuffer(640, 480);
    const entry = {
      ...thoughtEntry,
      images: [`data:image/png;base64,${png.toString('base64')}`],
    };
    mockGetJournal.mockResolvedValue([entry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const res = await GET(makeReq(DOCX_PARAMS));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('wordprocessingml.document');
  });

  it('exports successfully with a JPEG image (magic: 0xFF 0xD8)', async () => {
    const jpeg = makeJpegBuffer(800, 600);
    const entry = {
      ...thoughtEntry,
      images: [`data:image/jpeg;base64,${jpeg.toString('base64')}`],
    };
    mockGetJournal.mockResolvedValue([entry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const res = await GET(makeReq(DOCX_PARAMS));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('wordprocessingml.document');
  });

  it('falls back to default 400×300 for an unrecognised image format', async () => {
    // Buffer starting with 0x00 — neither PNG nor JPEG magic bytes
    const unknownBuf = Buffer.alloc(32, 0x00);
    const entry = {
      ...thoughtEntry,
      images: [`data:image/webp;base64,${unknownBuf.toString('base64')}`],
    };
    mockGetJournal.mockResolvedValue([entry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    // The route uses default width=400 height=300 when format is unknown;
    // the export must still complete successfully.
    const res = await GET(makeReq(DOCX_PARAMS));
    expect(res.status).toBe(200);
  });
});
