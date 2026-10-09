/**
 * Tier 5 — GET /api/journal/export
 *
 * Tests:
 *  - Validation (missing endDate → 400)
 *  - JSON format: date-range filtering, game attachment, groupedByDate shape
 *  - DOCX format: streamed NDJSON protocol (progress lines, then a final "done"
 *    line carrying the .docx as base64, or an "error" line), selective
 *    saveJournalEntry caching of generated board images, duplicate-entry
 *    deduplication via processedEntryIds, FEN board-image fetch
 *  - Image magic-byte detection: PNG (0x89 0x50) and JPEG (0xFF 0xD8) helper
 *    functions; unknown format falls back to default dimensions gracefully
 *
 * The real `docx` library is used (not mocked) — it embeds raw image bytes
 * without content validation, so minimal synthetic buffers are safe to use.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { gameA, gameB, thoughtEntry, moveEntry, summaryEntry, TEST_USERNAME } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getJournal:  vi.fn(),
  getGames:    vi.fn(),
  getAnalysis: vi.fn(),
  saveJournalEntry: vi.fn(),
}));

// The export gets a board image straight from the store (making it if need be),
// then fetches the stored file. The store is stubbed to hand back an address, and
// global fetch to prevent real HTTP calls: it returns { ok: false } by default so
// image generation fails gracefully (the route logs it and writes the FEN instead).
vi.mock('@/lib/board-image-storage', () => ({ getCachedBoardImage: vi.fn() }));
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { GET } from '@/app/api/journal/export/route';
import { getJournal, getGames, getAnalysis, saveJournalEntry } from '@/lib/db';
import { getCachedBoardImage } from '@/lib/board-image-storage';

const mockBoardImage = vi.mocked(getCachedBoardImage);
const STORED_BOARD = 'https://store.example/boards/abc-white.png';

const mockGetJournal  = vi.mocked(getJournal);
const mockGetGames    = vi.mocked(getGames);
const mockGetAnalysis = vi.mocked(getAnalysis);
const mockSaveEntry   = vi.mocked(saveJournalEntry);

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
  mockBoardImage.mockReset();
  mockBoardImage.mockResolvedValue(STORED_BOARD);
  mockGetJournal.mockResolvedValue([]);
  mockGetGames.mockResolvedValue({});
  mockGetAnalysis.mockResolvedValue(null);
  mockSaveEntry.mockResolvedValue(undefined);
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

// ─── Accuracy on post-game summaries ──────────────────────────────────────────
//
// A summary saved its accuracy under whatever formula was in use when it was written;
// the export shows the analysis's current figure for the author's side instead.
// (summaryEntry: the author had White, saved 87.5%.)

describe('GET /api/journal/export — accuracy on post-game summaries', () => {
  const range = { startDate: '2026-03-10', endDate: '2026-03-10' };
  const statsOf = async () => {
    const { entries } = await (await GET(makeReq(range))).json();
    return entries.find((e: any) => e.entryType === 'post_game_summary').postGameSummary.statistics;
  };

  it('shows the analysis’s current accuracy for the author’s side, not the saved one', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, summaryEntry]);
    mockGetAnalysis.mockResolvedValue({ whiteAccuracy: 91.2, blackAccuracy: 70.1 });

    expect((await statsOf()).accuracy).toBe(91.2);
    expect(mockGetAnalysis).toHaveBeenCalledWith('game-111');
  });

  it('keeps the other statistics as they were saved', async () => {
    mockGetJournal.mockResolvedValue([summaryEntry]);
    mockGetAnalysis.mockResolvedValue({ whiteAccuracy: 91.2, blackAccuracy: 70.1 });

    expect(await statsOf()).toEqual({ ...summaryEntry.postGameSummary!.statistics, accuracy: 91.2 });
  });

  it('keeps the saved accuracy when the game has no analysis', async () => {
    mockGetJournal.mockResolvedValue([summaryEntry]);
    mockGetAnalysis.mockResolvedValue(null);

    expect((await statsOf()).accuracy).toBe(87.5);
  });

  it('keeps the saved accuracy, and still exports, when the analysis cannot be read', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetJournal.mockResolvedValue([summaryEntry]);
    mockGetAnalysis.mockRejectedValue(new Error('redis went away'));

    const res = await GET(makeReq(range));

    expect(res.status).toBe(200);
    expect((await statsOf()).accuracy).toBe(87.5);
    quiet.mockRestore();
  });

  it('does not read any analysis when no summary is in the export', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, moveEntry]);

    await GET(makeReq(range));

    expect(mockGetAnalysis).not.toHaveBeenCalled();
  });

  it('still produces a Word document when the analysis cannot be read', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetJournal.mockResolvedValue([summaryEntry]);
    mockGetAnalysis.mockRejectedValue(new Error('redis went away'));

    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));

    expect(doneOf(msgs)).toBeDefined();
    quiet.mockRestore();
  });
});

// ─── DOCX format ──────────────────────────────────────────────────────────────
//
// The docx branch streams newline-delimited JSON: one {type:'progress'} line
// per entry, then a single {type:'done'} line carrying the finished file as
// base64 — or {type:'error'}. The generator keeps running after GET() returns,
// so every test must read the stream to the end before asserting anything.

type ExportMessage =
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; filename: string; data: string }
  | { type: 'error'; message: string };

async function readExport(res: Response): Promise<ExportMessage[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as ExportMessage);
}

const progressOf = (msgs: ExportMessage[]) =>
  msgs.filter((m): m is Extract<ExportMessage, { type: 'progress' }> => m.type === 'progress');
const doneOf = (msgs: ExportMessage[]) =>
  msgs.find((m): m is Extract<ExportMessage, { type: 'done' }> => m.type === 'done');

/** A .docx is a zip archive, so a real one starts with the "PK" signature. */
const isZip = (base64: string) => {
  const bytes = Buffer.from(base64, 'base64');
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
};

describe('GET /api/journal/export — DOCX format', () => {
  it('streams NDJSON rather than sending a binary download', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const res = await GET(makeReq(DOCX_PARAMS));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');
    expect(res.headers.get('Content-Disposition')).toBeNull();
    await readExport(res);
  });

  it('finishes with a done message whose filename includes the date range', async () => {
    mockGetJournal.mockResolvedValue([]);
    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(msgs[msgs.length - 1].type).toBe('done');
    expect(doneOf(msgs)!.filename).toBe('chess-journal-2026-03-10-to-2026-03-10.docx');
  });

  it('the done message carries a valid .docx (zip) archive as base64', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(isZip(doneOf(msgs)!.data)).toBe(true);
  });

  // ── Progress ──────────────────────────────────────────────────────────────

  it('emits one progress message per entry, counting up to the total, before done', async () => {
    const second = { ...thoughtEntry, id: 1003, timestamp: '2026-03-10T10:30:00.000Z' };
    mockGetJournal.mockResolvedValue([thoughtEntry, second]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));

    expect(progressOf(msgs).map(m => [m.current, m.total])).toEqual([[1, 2], [2, 2]]);
    expect(msgs.map(m => m.type)).toEqual(['progress', 'progress', 'done']);
  });

  it('emits only a done message when there are no entries in range', async () => {
    mockGetJournal.mockResolvedValue([]);
    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(msgs.map(m => m.type)).toEqual(['done']);
  });

  it('only counts entries in the requested date range', async () => {
    const outside = { ...thoughtEntry, id: 1004, date: '2026-01-01' };
    mockGetJournal.mockResolvedValue([thoughtEntry, outside]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(progressOf(msgs)).toEqual([{ type: 'progress', current: 1, total: 1 }]);
  });

  // ── Duplicate-entry deduplication ─────────────────────────────────────────

  it('deduplicates entries with the same id, and the progress bar still reaches 100%', async () => {
    // The second occurrence of an id is skipped, so total must count unique ids
    // or the bar would stop at 50%.
    const dup = { ...thoughtEntry }; // identical id
    mockGetJournal.mockResolvedValue([thoughtEntry, dup]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));

    expect(progressOf(msgs)).toEqual([{ type: 'progress', current: 1, total: 1 }]);
    expect(isZip(doneOf(msgs)!.data)).toBe(true);
  });

  // ── FEN board-image fetching and caching ──────────────────────────────────

  it('gets a board image from the store when entry has a FEN but no cached image', async () => {
    mockGetJournal.mockResolvedValue([{ ...moveEntry }]); // moveEntry has a FEN
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(mockBoardImage).toHaveBeenCalledWith(moveEntry.fen, 'white');
    expect(fetchMock).toHaveBeenCalledWith(STORED_BOARD);
  });

  it('draws the board from Black’s side for a game the author played as Black', async () => {
    mockGetJournal.mockResolvedValue([{ ...moveEntry, gameId: gameB.id }]);
    mockGetGames.mockResolvedValue({ [gameB.id]: gameB });
    await readExport(await GET(makeReq({ ...DOCX_PARAMS, username: TEST_USERNAME })));
    expect(mockBoardImage).toHaveBeenCalledWith(moveEntry.fen, 'black');
  });

  it('draws it from White’s side for a game the author played as White', async () => {
    mockGetJournal.mockResolvedValue([{ ...moveEntry }]);
    mockGetGames.mockResolvedValue({ [gameA.id]: gameA });
    await readExport(await GET(makeReq({ ...DOCX_PARAMS, username: TEST_USERNAME })));
    expect(mockBoardImage).toHaveBeenCalledWith(moveEntry.fen, 'white');
  });

  it('does not go through the public board-image endpoint, which makes images only for a signed-in browser', async () => {
    mockGetJournal.mockResolvedValue([{ ...moveEntry }]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/board-image'));
  });

  it('writes the position as text, and still delivers the document, when the image cannot be made', async () => {
    mockGetJournal.mockResolvedValue([{ ...moveEntry }]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    mockBoardImage.mockRejectedValue(new Error('image service down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(isZip(doneOf(msgs)!.data)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSaveEntry).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('skips the board-image fetch when a cached image is present at images[0]', async () => {
    const cachedPng = `data:image/png;base64,${Buffer.alloc(24).toString('base64')}`;
    const cachedEntry = { ...moveEntry, images: [cachedPng] };
    mockGetJournal.mockResolvedValue([cachedEntry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    await readExport(await GET(makeReq(DOCX_PARAMS)));
    // No board-image HTTP call needed when the cache hit exists
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches a generated board image by saving only that entry — never the whole journal', async () => {
    const other = { ...thoughtEntry, id: 1003, timestamp: '2026-03-10T10:30:00.000Z' };
    mockGetJournal.mockResolvedValue([{ ...moveEntry }, other]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const png = new Uint8Array(makePngBuffer(240, 240)).buffer;
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => png });

    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));

    // Exactly one entry — the one that gained an image — is written back.
    // (The db mock has no saveJournal, so a whole-journal write would throw.)
    expect(mockSaveEntry).toHaveBeenCalledTimes(1);
    const saved = mockSaveEntry.mock.calls[0][0];
    expect(saved.id).toBe(moveEntry.id);
    expect(saved.images[0]).toMatch(/^data:image\/png;base64,/);
    expect(isZip(doneOf(msgs)!.data)).toBe(true);
  });

  it('writes nothing back when no board image was generated', async () => {
    // Default fetch mock returns { ok: false }, so no image is produced.
    mockGetJournal.mockResolvedValue([{ ...moveEntry }, { ...thoughtEntry }]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(mockSaveEntry).not.toHaveBeenCalled();
  });

  it('still delivers the document when caching an image back fails', async () => {
    mockGetJournal.mockResolvedValue([{ ...moveEntry }]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const png = new Uint8Array(makePngBuffer(240, 240)).buffer;
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => png });
    mockSaveEntry.mockRejectedValue(new Error('Redis is full'));

    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(doneOf(msgs)).toBeDefined();
    expect(msgs.some(m => m.type === 'error')).toBe(false);
  });

  // ── Failure ────────────────────────────────────────────────────────────────

  it('reports a mid-stream failure as an error message instead of a done message', async () => {
    // An AI review with no content makes document generation throw partway through.
    const broken = {
      ...thoughtEntry,
      aiReview: { content: undefined, model: 'claude-sonnet-5', timestamp: '2026-03-10T11:00:00.000Z' },
    };
    mockGetJournal.mockResolvedValue([broken]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });

    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(doneOf(msgs)).toBeUndefined();
    const last = msgs[msgs.length - 1];
    expect(last.type).toBe('error');
    expect((last as Extract<ExportMessage, { type: 'error' }>).message).toBeTruthy();
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
    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(isZip(doneOf(msgs)!.data)).toBe(true);
  });

  it('exports successfully with a JPEG image (magic: 0xFF 0xD8)', async () => {
    const jpeg = makeJpegBuffer(800, 600);
    const entry = {
      ...thoughtEntry,
      images: [`data:image/jpeg;base64,${jpeg.toString('base64')}`],
    };
    mockGetJournal.mockResolvedValue([entry]);
    mockGetGames.mockResolvedValue({ 'game-111': gameA });
    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(isZip(doneOf(msgs)!.data)).toBe(true);
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
    const msgs = await readExport(await GET(makeReq(DOCX_PARAMS)));
    expect(doneOf(msgs)).toBeDefined();
    expect(msgs.some(m => m.type === 'error')).toBe(false);
  });
});

