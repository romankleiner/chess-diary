import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DirectoryEntry } from '@/lib/blog-directory';

vi.mock('@/lib/blog-directory-server', () => ({ loadBlogDirectory: vi.fn() }));
vi.mock('@/lib/blog-visits-server', () => ({ recordVisit: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDirectoryOwner: vi.fn(), getOrCreateDirectoryKey: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ 'x-real-ip': '203.0.113.7' })) }));

import BlogDirectoryPage, { dynamic, metadata } from '@/app/blog/page';
import BlogLayout, { metadata as layoutMetadata } from '@/app/blog/layout';
import { loadBlogDirectory } from '@/lib/blog-directory-server';
import { recordVisit } from '@/lib/blog-visits-server';
import { getDirectoryOwner, getOrCreateDirectoryKey } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

const mockLoad      = vi.mocked(loadBlogDirectory);
const mockRecord    = vi.mocked(recordVisit);
const mockOwnerOf   = vi.mocked(getDirectoryOwner);
const mockOwnKey    = vi.mocked(getOrCreateDirectoryKey);
const mockAuth      = vi.mocked(auth);

const ALICE_KEY = 'AbCdEfGhIjKlMnOpQrStUv';   // 22 characters of base64url
const OTHER_KEY = 'ZzZzZzZzZzZzZzZzZzZzZz';

const entry = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  gameId: '100', white: 'romank66', black: 'opponent_a', whiteRating: 1523, blackRating: 1480, authorColor: 'white', opponent: 'opponent_a',
  result: 'win', inProgress: false, startDate: '2026-07-10', endDate: '2026-07-24', timeControl: '1 day per move',
  commentedMoves: 9, hasSummary: true,
  ...over,
});
const entries = [
  entry({ gameId: '300', black: 'Late_One', startDate: '2026-09-01', endDate: '2026-09-16' }),
  entry({ gameId: '200', black: 'Middle_One', result: 'draw', startDate: '2026-07-20', endDate: '2026-07-30' }),
  entry({ gameId: '100' }),
];

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** Render the page as a request with these query parameters would. */
const visit = async (query: Record<string, string | string[] | undefined> = {}) =>
  renderToStaticMarkup(await BlogDirectoryPage({ searchParams: Promise.resolve(query) }));

/** The page answered with a 404. */
const expectNotFound = async (query: Record<string, string | string[] | undefined> = {}) => {
  await expect(BlogDirectoryPage({ searchParams: Promise.resolve(query) })).rejects.toMatchObject({
    digest: expect.stringContaining('404'),
  });
};

const signedOut = () => mockAuth.mockResolvedValue({ userId: null } as never);
const signedInAs = (userId: string) => mockAuth.mockResolvedValue({ userId } as never);

beforeEach(() => {
  vi.resetAllMocks();
  signedOut();
  mockOwnerOf.mockImplementation(async key => (key === ALICE_KEY ? 'alice' : null));
  mockOwnKey.mockImplementation(async uid => (uid === 'alice' ? ALICE_KEY : OTHER_KEY));
  mockLoad.mockResolvedValue(entries);
});

// ─── who may see it ───────────────────────────────────────────────────────────

describe('the directory page — without the key', () => {
  it('does not exist for someone with no key: a plain 404', async () => {
    await expectNotFound();
  });

  it('gives nothing away: no lookup, no games read, no visit logged', async () => {
    await expectNotFound();
    expect(mockOwnerOf).not.toHaveBeenCalled();
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('is a 404 for a key that opens nothing', async () => {
    await expectNotFound({ key: OTHER_KEY });
    expect(mockOwnerOf).toHaveBeenCalledWith(OTHER_KEY);
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('does not even look up something that is not shaped like a key', async () => {
    for (const key of ['', 'short', 'x'.repeat(23), 'AbCdEfGhIjKlMnOpQrSt!v', '../../etc/passwd']) {
      await expectNotFound({ key });
    }
    expect(mockOwnerOf).not.toHaveBeenCalled();
  });

  it('is a 404 when the key is given twice', async () => {
    await expectNotFound({ key: [ALICE_KEY, ALICE_KEY] });
  });
});

describe('the directory page — with the key', () => {
  it('shows the author’s games to anyone holding their key, newest first', async () => {
    mockLoad.mockResolvedValue([entries[2], entries[0], entries[1]]);
    const html = await visit({ key: ALICE_KEY });

    expect(mockLoad).toHaveBeenCalledWith('alice');
    expect(textOf(html)).toContain('Game blogs');
    const order = ['300', '200', '100'].map(id => html.indexOf(`href="/blog/${id}"`));
    expect(order.every(i => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('logs the view as a visitor’s, against the author whose directory it is', async () => {
    await visit({ key: ALICE_KEY });
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const [owner, headers, details] = mockRecord.mock.calls[0];
    expect(owner).toBe('alice');
    expect(headers.get('x-real-ip')).toBe('203.0.113.7');
    expect(details).toEqual({ page: 'directory', viewer: 'visitor' });
  });

  it('does not show a visitor the box for sharing the link', async () => {
    expect(textOf(await visit({ key: ALICE_KEY }))).not.toContain('Your secret link');
  });

  it('lets a signed-in reader holding someone else’s key see that directory, as a visitor', async () => {
    signedInAs('bob');
    const html = await visit({ key: ALICE_KEY });
    expect(mockLoad).toHaveBeenCalledWith('alice');
    expect(textOf(html)).not.toContain('Your secret link');
    expect(mockRecord.mock.calls[0][2]).toEqual({ page: 'directory', viewer: 'visitor' });
  });
});

describe('the directory page — for its author', () => {
  it('shows a signed-in author their own directory without a key, with the link to share', async () => {
    signedInAs('alice');
    const html = await visit();
    expect(mockOwnKey).toHaveBeenCalledWith('alice');
    expect(mockLoad).toHaveBeenCalledWith('alice');
    expect(textOf(html)).toContain('Your secret link to this page');
    expect(html).toContain(`/blog?key=${ALICE_KEY}`);
  });

  it('logs the author’s own look as theirs', async () => {
    signedInAs('alice');
    await visit();
    expect(mockRecord.mock.calls[0][2]).toEqual({ page: 'directory', viewer: 'owner' });
  });

  it('still shows the author the box when they open their own link', async () => {
    signedInAs('alice');
    expect(textOf(await visit({ key: ALICE_KEY }))).toContain('Your secret link');
  });

  it('does not fall back to the author’s own directory when they bring a key that opens nothing', async () => {
    signedInAs('alice');
    await expectNotFound({ key: OTHER_KEY });
    expect(mockOwnKey).not.toHaveBeenCalled();
  });

  it('does not fall back to it for anything else in place of a key either', async () => {
    signedInAs('alice');
    await expectNotFound({ key: 'letmein' });
    await expectNotFound({ key: '' });
    await expectNotFound({ key: [ALICE_KEY, ALICE_KEY] });
    expect(mockOwnKey).not.toHaveBeenCalled();
  });

  it('gives a signed-in author with nothing shared an empty directory, not an error', async () => {
    signedInAs('carol');
    mockLoad.mockResolvedValue([]);
    const html = await visit();
    expect(textOf(html)).toContain('No games have been shared yet.');
    expect(html).not.toContain('role="alert"');
  });
});

describe('the directory page — when something fails', () => {
  it('says so in an alert when the games cannot be read, rather than failing the page', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockLoad.mockRejectedValue(new Error('redis down'));
    const html = await visit({ key: ALICE_KEY });

    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('couldn\'t be loaded right now');
    expect(html).not.toContain('redis down');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('says so in an alert when the key cannot be checked, rather than claiming the page does not exist', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockOwnerOf.mockRejectedValue(new Error('redis down'));
    const html = await visit({ key: ALICE_KEY });

    expect(html).toContain('role="alert"');
    expect(html).not.toContain('href="/blog/');
    expect(mockRecord).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('still answers 404, without touching the database, for a keyless visitor while it is down', async () => {
    mockOwnerOf.mockRejectedValue(new Error('redis down'));
    await expectNotFound();
  });
});

// ─── search engines ───────────────────────────────────────────────────────────

describe('the directory and the blogs under it — search engines', () => {
  it('is read on each visit, not when the site is built', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('keeps its title and description', () => {
    expect(metadata.title).toBe('Game blogs — Chess Diary');
    expect(String(metadata.description)).toContain('guess the move');
  });

  it('asks search engines not to index, follow or keep a copy of any page under /blog', () => {
    expect(layoutMetadata.robots).toMatchObject({
      index: false, follow: false, nocache: true,
      googleBot: { index: false, follow: false, noimageindex: true },
    });
  });

  it('leaves the pages under it as they are', () => {
    expect(renderToStaticMarkup(BlogLayout({ children: <p>inside</p> }) as React.ReactElement)).toBe('<p>inside</p>');
  });

  it('sends the same request as a header, for the pages and the data they load', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../../next.config.js');
    const rules: Array<{ source: string; headers: Array<{ key: string; value: string }> }> = await config.headers();
    for (const source of ['/blog', '/blog/:path*', '/api/games/:id/blog-post']) {
      const rule = rules.find(r => r.source === source);
      expect(rule, source).toBeDefined();
      expect(rule!.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' });
    }
  });

  it('keeps the rest of the configuration', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../../next.config.js');
    expect(config.experimental.serverActions.bodySizeLimit).toBe('2mb');
    expect(config.experimental.outputFileTracingIncludes['/api/**/*']).toEqual(['./public/books/opening-book.bin']);
  });
});
