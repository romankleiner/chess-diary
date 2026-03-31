import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  getSettings: vi.fn(),
  saveSetting: vi.fn(),
}));

import { GET, PUT } from '@/app/api/settings/route';
import { getSettings, saveSetting } from '@/lib/db';

const mockGetSettings = vi.mocked(getSettings);
const mockSaveSetting = vi.mocked(saveSetting);

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveSetting.mockResolvedValue(undefined);
});

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/settings', () => {
  it('returns an empty settings object when nothing is stored', async () => {
    mockGetSettings.mockResolvedValue({});
    const req = new NextRequest('http://localhost/api/settings');
    const { settings } = await (await GET(req)).json();
    expect(settings).toEqual({});
  });

  it('returns stored settings as key/value pairs', async () => {
    mockGetSettings.mockResolvedValue({ chesscom_username: 'player', ai_model: 'sonnet' });
    const req = new NextRequest('http://localhost/api/settings');
    const { settings } = await (await GET(req)).json();
    expect(settings.chesscom_username).toBe('player');
    expect(settings.ai_model).toBe('sonnet');
  });

  it('returns 200', async () => {
    mockGetSettings.mockResolvedValue({});
    expect((await GET(new NextRequest('http://localhost/api/settings'))).status).toBe(200);
  });

  it('normalises a null return from db to {}', async () => {
    // In some redis implementations hgetall returns null
    mockGetSettings.mockResolvedValue(null as any);
    const req = new NextRequest('http://localhost/api/settings');
    const { settings } = await (await GET(req)).json();
    expect(settings).toEqual({});
  });
});

// ─── PUT ──────────────────────────────────────────────────────────────────────

describe('PUT /api/settings', () => {
  it('calls saveSetting once per key in the body', async () => {
    mockGetSettings.mockResolvedValue({ chesscom_username: 'user', ai_model: 'model' });
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chesscom_username: 'user', ai_model: 'model' }),
    });
    await PUT(req);
    expect(mockSaveSetting).toHaveBeenCalledTimes(2);
  });

  it('coerces values to strings when saving', async () => {
    mockGetSettings.mockResolvedValue({ analysis_depth: '20' });
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis_depth: 20 }), // number, not string
    });
    await PUT(req);
    const [key, value] = mockSaveSetting.mock.calls[0];
    expect(key).toBe('analysis_depth');
    expect(typeof value).toBe('string');
    expect(value).toBe('20');
  });

  it('returns success:true and the updated settings', async () => {
    mockGetSettings.mockResolvedValue({ chesscom_username: 'newuser' });
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chesscom_username: 'newuser' }),
    });
    const { success, settings } = await (await PUT(req)).json();
    expect(success).toBe(true);
    expect(settings.chesscom_username).toBe('newuser');
  });
});
