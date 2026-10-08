import { describe, it, expect } from 'vitest';
import {
  BLOG_VISITS_KEPT, agentLabel, asVisit, clientIp, describeAgent, locationLabel, referrerLabel, referrerOf, summarizeVisits,
  visitFromHeaders, type BlogVisit,
} from '@/lib/access-log';
import { DIRECTORY_KEY_PARAM, DIRECTORY_KEY_STORAGE, directoryPath, isDirectoryKey, storedDirectoryKey } from '@/lib/directory-key';

const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.79',
  operaWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0',
  samsungAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  whatsapp: 'WhatsApp/2.23.20.0',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  curl: 'curl/8.4.0',
  python: 'python-requests/2.31.0',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36',
};

// ─── the directory key ────────────────────────────────────────────────────────

describe('isDirectoryKey', () => {
  it('accepts 22 characters of base64url, the shape of 128 random bits', () => {
    expect(isDirectoryKey('AbCdEfGhIjKlMnOpQrStUv')).toBe(true);
    expect(isDirectoryKey('0123456789-_abcdefghij')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['', 'short', 'AbCdEfGhIjKlMnOpQrStU', 'AbCdEfGhIjKlMnOpQrStUvW', 'AbCdEfGhIjKlMnOpQrSt+v', 'AbCdEfGhIjKlMnOpQrSt/v',
      'AbCdEfGhIjKlMnOpQrSt=v', 'AbCdEfGhIjKlMnOpQrSt v', ' AbCdEfGhIjKlMnOpQrStUv', null, undefined, 42, ['AbCdEfGhIjKlMnOpQrStUv'], {}]) {
      expect(isDirectoryKey(value), String(value)).toBe(false);
    }
  });
});

describe('storedDirectoryKey', () => {
  const storage = (value: string | null) => ({ getItem: (name: string) => (name === DIRECTORY_KEY_STORAGE ? value : null) });

  it('gives back a key the browser remembered', () => {
    expect(storedDirectoryKey(() => storage('AbCdEfGhIjKlMnOpQrStUv'))).toBe('AbCdEfGhIjKlMnOpQrStUv');
  });

  it('gives nothing when there is none', () => {
    expect(storedDirectoryKey(() => storage(null))).toBeNull();
  });

  it('does not trust something stored there that is not a key', () => {
    for (const junk of ['', 'javascript:alert(1)', '/evil', 'AbCdEfGhIjKlMnOpQrStUvW', '"><script>']) {
      expect(storedDirectoryKey(() => storage(junk)), junk).toBeNull();
    }
  });

  it('reads storage that is switched off as no key, rather than failing', () => {
    expect(storedDirectoryKey(() => { throw new Error('SecurityError'); })).toBeNull();
    expect(storedDirectoryKey(() => ({ getItem: () => { throw new Error('denied'); } }))).toBeNull();
  });
});

describe('directoryPath', () => {
  it('puts the key in the query of /blog', () => {
    expect(directoryPath('AbCdEfGhIjKlMnOpQrStUv')).toBe('/blog?key=AbCdEfGhIjKlMnOpQrStUv');
    expect(DIRECTORY_KEY_PARAM).toBe('key');
  });

  it('encodes whatever it is given, so it can never break out of the query', () => {
    expect(directoryPath('a&b=c#d')).toBe('/blog?key=a%26b%3Dc%23d');
  });

  it('remembers the key under a name of the app’s own', () => {
    expect(DIRECTORY_KEY_STORAGE).toMatch(/^chess-diary:/);
  });
});

// ─── reading a request ────────────────────────────────────────────────────────

describe('clientIp', () => {
  it('takes Vercel’s x-real-ip first', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.7');
  });

  it('falls back to the first hop of x-forwarded-for', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1');
    expect(clientIp(new Headers({ 'x-forwarded-for': ' 2001:db8::1 ' }))).toBe('2001:db8::1');
  });

  it('is null when neither is there', () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ 'x-forwarded-for': ' , ' }))).toBeNull();
  });

  it('keeps no more than an address could be', () => {
    expect(clientIp(new Headers({ 'x-real-ip': 'x'.repeat(500) }))!.length).toBe(64);
  });
});

describe('referrerOf', () => {
  it('keeps the origin and the path', () => {
    expect(referrerOf('https://example.com/some/page')).toBe('https://example.com/some/page');
  });

  it('drops the query and fragment, which may carry the directory’s key', () => {
    expect(referrerOf('https://chess.example/blog?key=AbCdEfGhIjKlMnOpQrStUv#x')).toBe('https://chess.example/blog');
  });

  it('ignores anything that is not an http(s) address', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'not a url', '', null]) {
      expect(referrerOf(value), String(value)).toBeNull();
    }
  });
});

describe('visitFromHeaders', () => {
  const now = new Date('2026-10-08T12:34:56.000Z');
  const headers = new Headers({
    'x-real-ip': '203.0.113.7',
    'x-vercel-ip-city': 'S%C3%A3o%20Paulo',
    'x-vercel-ip-country-region': 'SP',
    'x-vercel-ip-country': 'BR',
    'user-agent': UA.chromeWindows,
    referer: 'https://chess.example/blog?key=AbCdEfGhIjKlMnOpQrStUv',
  });

  it('records when, what, who and from where', () => {
    expect(visitFromHeaders(headers, { page: 'game', gameId: '952794945', viewer: 'visitor', now })).toEqual({
      at: '2026-10-08T12:34:56.000Z', page: 'game', gameId: '952794945', viewer: 'visitor',
      ip: '203.0.113.7', city: 'São Paulo', region: 'SP', country: 'BR',
      userAgent: UA.chromeWindows, referrer: 'https://chess.example/blog',
    });
  });

  it('has no game for a view of the directory', () => {
    expect(visitFromHeaders(headers, { page: 'directory', viewer: 'owner', now })).toMatchObject({ page: 'directory', gameId: null, viewer: 'owner' });
  });

  it('records nothing it was not given', () => {
    expect(visitFromHeaders(new Headers(), { page: 'directory', viewer: 'visitor', now })).toEqual({
      at: now.toISOString(), page: 'directory', gameId: null, viewer: 'visitor',
      ip: null, city: null, region: null, country: null, userAgent: null, referrer: null,
    });
  });

  it('keeps a city whose encoding is broken as it came', () => {
    expect(visitFromHeaders(new Headers({ 'x-vercel-ip-city': 'Bad%E0%A4%A' }), { page: 'directory', viewer: 'visitor', now }).city).toBe('Bad%E0%A4%A');
  });

  it('cuts down headers a visitor could make as long as they like', () => {
    const v = visitFromHeaders(new Headers({ 'user-agent': 'x'.repeat(5000), 'x-vercel-ip-country': 'X'.repeat(50) }), { page: 'directory', viewer: 'visitor', now });
    expect(v.userAgent!.length).toBe(300);
    expect(v.country!.length).toBe(8);
  });

  it('uses the time now when not told', () => {
    const before = Date.now();
    const at = Date.parse(visitFromHeaders(new Headers(), { page: 'directory', viewer: 'visitor' }).at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});

describe('asVisit', () => {
  const good = { at: '2026-10-08T00:00:00.000Z', page: 'game', gameId: '1', viewer: 'visitor', ip: '1.2.3.4', city: null, region: null, country: 'GB', userAgent: 'x', referrer: null };

  it('takes a well-formed record', () => {
    expect(asVisit(good)).toEqual(good);
  });

  it('turns anything that is not text into null', () => {
    expect(asVisit({ ...good, ip: 42, city: { x: 1 } })).toMatchObject({ ip: null, city: null });
  });

  it('rejects a record missing what it must have', () => {
    for (const bad of [null, 'x', 42, [], {}, { ...good, at: 1 }, { ...good, page: 'admin' }, { ...good, viewer: 'root' }]) {
      expect(asVisit(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

// ─── describing a visit ───────────────────────────────────────────────────────

describe('describeAgent', () => {
  it.each([
    ['chromeWindows', 'Chrome', 'Windows'],
    ['safariIphone', 'Safari', 'iOS'],
    ['chromeIphone', 'Chrome', 'iOS'],
    ['firefoxMac', 'Firefox', 'macOS'],
    ['safariMac', 'Safari', 'macOS'],
    ['edgeWindows', 'Edge', 'Windows'],
    ['operaWindows', 'Opera', 'Windows'],
    ['samsungAndroid', 'Samsung Internet', 'Android'],
    ['chromeAndroid', 'Chrome', 'Android'],
    ['firefoxLinux', 'Firefox', 'Linux'],
    ['chromebook', 'Chrome', 'ChromeOS'],
  ] as const)('reads %s as %s on %s, not a bot', (name, browser, os) => {
    expect(describeAgent(UA[name])).toEqual({ browser, os, bot: false });
  });

  it.each(['googlebot', 'bingbot', 'whatsapp', 'slack', 'facebook', 'curl', 'python', 'headless'] as const)('calls %s a bot or script', name => {
    expect(describeAgent(UA[name]).bot).toBe(true);
  });

  it('knows nothing of a missing or unrecognised agent', () => {
    expect(describeAgent(null)).toEqual({ browser: null, os: null, bot: false });
    expect(describeAgent('SomethingNew/1.0')).toEqual({ browser: null, os: null, bot: false });
  });
});

describe('agentLabel', () => {
  it('names the browser and the system', () => {
    expect(agentLabel(UA.chromeWindows)).toBe('Chrome on Windows');
    expect(agentLabel(UA.safariIphone)).toBe('Safari on iOS');
  });

  it('calls a bot a bot, whatever else it says', () => {
    expect(agentLabel(UA.googlebot)).toBe('Bot or script');
    expect(agentLabel(UA.headless)).toBe('Bot or script');
  });

  it('says what it can, or that it does not know', () => {
    expect(agentLabel('Mozilla/5.0 (Windows NT 10.0)')).toBe('Windows');
    expect(agentLabel('SomethingNew/1.0')).toBe('Unknown browser');
    expect(agentLabel(null)).toBe('Unknown browser');
  });
});

describe('locationLabel', () => {
  it('gives what is known, city first', () => {
    expect(locationLabel({ city: 'London', region: 'ENG', country: 'GB' })).toBe('London, ENG, GB');
    expect(locationLabel({ city: null, region: null, country: 'GB' })).toBe('GB');
    expect(locationLabel({ city: null, region: null, country: null })).toBe('Unknown');
  });
});

describe('referrerLabel', () => {
  const own = 'https://chess.example';

  it('calls this site’s directory "The directory"', () => {
    expect(referrerLabel('https://chess.example/blog', own)).toBe('The directory');
  });

  it('gives another page of this site by its path', () => {
    expect(referrerLabel('https://chess.example/blog/952794945', own)).toBe('/blog/952794945');
  });

  it('gives another site by its host', () => {
    expect(referrerLabel('https://www.google.com/search', own)).toBe('www.google.com');
    expect(referrerLabel('https://chess.example/blog', null)).toBe('chess.example');
  });

  it('shows a dash when there is nothing to show', () => {
    expect(referrerLabel(null, own)).toBe('—');
    expect(referrerLabel('not a url', own)).toBe('—');
  });
});

// ─── summing up ───────────────────────────────────────────────────────────────

describe('summarizeVisits', () => {
  const now = new Date('2026-10-08T12:00:00.000Z');
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const v = (over: Partial<BlogVisit>): BlogVisit => ({
    at: at(1), page: 'game', gameId: '1', viewer: 'visitor', ip: '1.1.1.1', city: null, region: null, country: null, userAgent: UA.chromeWindows, referrer: null,
    ...over,
  });

  const log = [
    v({ ip: '1.1.1.1', at: at(1) }),
    v({ ip: '1.1.1.1', at: at(2) }),
    v({ ip: '2.2.2.2', at: at(30) }),                        // yesterday
    v({ ip: '3.3.3.3', at: at(24 * 10), userAgent: UA.googlebot }),  // 10 days ago, a bot
    v({ ip: '9.9.9.9', at: at(1), viewer: 'owner' }),       // the author
    v({ ip: null, at: at(3) }),
  ];

  it('counts views and distinct addresses by others in the period', () => {
    expect(summarizeVisits(log, { now, days: 1 })).toEqual({ views: 3, addresses: 1, bots: 0 });
    expect(summarizeVisits(log, { now, days: 7 })).toEqual({ views: 4, addresses: 2, bots: 0 });
    expect(summarizeVisits(log, { now, days: 30 })).toEqual({ views: 5, addresses: 3, bots: 1 });
  });

  it('leaves out the author’s own views', () => {
    expect(summarizeVisits([v({ viewer: 'owner' })], { now, days: 30 })).toEqual({ views: 0, addresses: 0, bots: 0 });
  });

  it('copes with an empty log', () => {
    expect(summarizeVisits([], { now, days: 7 })).toEqual({ views: 0, addresses: 0, bots: 0 });
  });

  it('keeps a bounded log', () => {
    expect(BLOG_VISITS_KEPT).toBe(2000);
  });
});
