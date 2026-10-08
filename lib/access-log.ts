/**
 * The log of who read the blog: one record per view of the directory or of a
 * game, built from the request's headers, and the wording the Visitors page
 * shows. Pure and browser-safe. (Recording visits is lib/blog-visits-server.ts.)
 *
 * "Who" can only be approximate: an IP address (which a whole office or mobile
 * network may share), a location Vercel works out from it (city-level at best),
 * and the browser's own description of itself. Every header is the visitor's to
 * set except the location ones Vercel adds, so nothing here is proof of identity.
 */

/** How many views an author's log keeps (newest first), so a flood of requests can't grow it without limit. */
export const BLOG_VISITS_KEPT = 2000;

export type VisitedPage = 'directory' | 'game';
/** The author reading their own blog, or anyone else. */
export type Viewer = 'owner' | 'visitor';

export interface BlogVisit {
  /** ISO time of the view. */
  at: string;
  page: VisitedPage;
  gameId: string | null;
  viewer: Viewer;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  userAgent: string | null;
  /** Where the visitor came from: origin and path only, never the query (it may carry a key). */
  referrer: string | null;
}

/** Headers are the visitor's to fill: nothing longer than this is kept. */
const MAX_HEADER = 300;

const clip = (value: string | null | undefined, max = MAX_HEADER): string | null => {
  const text = (value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

/** Vercel URL-encodes the city ("S%C3%A3o%20Paulo"). A malformed one is kept as it came. */
const decoded = (value: string | null): string | null => {
  if (!value) return null;
  try {
    return clip(decodeURIComponent(value));
  } catch {
    return clip(value);
  }
};

/** Request headers, from a route's request or from next/headers in a page. */
export type HeaderSource = Pick<Headers, 'get'>;

/** The visitor's address: Vercel's x-real-ip, else the first hop of x-forwarded-for. */
export function clientIp(headers: HeaderSource): string | null {
  const real = clip(headers.get('x-real-ip'), 64);
  if (real) return real;
  return clip(headers.get('x-forwarded-for')?.split(',')[0], 64);
}

/** Origin and path of the referring page; the query and fragment are dropped. Null for anything that isn't http(s). */
export function referrerOf(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return clip(url.origin + url.pathname);
  } catch {
    return null;
  }
}

export function visitFromHeaders(headers: HeaderSource, { page, gameId = null, viewer, now = new Date() }: {
  page: VisitedPage;
  gameId?: string | null;
  viewer: Viewer;
  now?: Date;
}): BlogVisit {
  return {
    at: now.toISOString(),
    page,
    gameId,
    viewer,
    ip: clientIp(headers),
    city: decoded(headers.get('x-vercel-ip-city')),
    region: clip(headers.get('x-vercel-ip-country-region'), 16),
    country: clip(headers.get('x-vercel-ip-country'), 8),
    userAgent: clip(headers.get('user-agent')),
    referrer: referrerOf(headers.get('referer')),
  };
}

/** A record read back from storage, or null if it isn't one (a stored line can't be trusted to be well formed). */
export function asVisit(value: unknown): BlogVisit | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.at !== 'string' || (v.page !== 'directory' && v.page !== 'game') || (v.viewer !== 'owner' && v.viewer !== 'visitor')) return null;
  const text = (x: unknown) => (typeof x === 'string' ? x : null);
  return {
    at: v.at, page: v.page, viewer: v.viewer,
    gameId: text(v.gameId), ip: text(v.ip), city: text(v.city), region: text(v.region), country: text(v.country),
    userAgent: text(v.userAgent), referrer: text(v.referrer),
  };
}

// ─── Describing a visit ───────────────────────────────────────────────────────

/** Crawlers, link previews and scripts announce themselves this way. */
const BOT = /bot|crawl|spider|slurp|preview|fetch|scan|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|headless|lighthouse|facebookexternalhit|whatsapp|telegram|discord|slack/i;

export interface AgentDescription {
  /** "Chrome", "Safari"…, or null when it can't be told. */
  browser: string | null;
  /** "Windows", "iOS"…, or null. */
  os: string | null;
  /** It says it is a crawler, a link preview or a script, not a person. */
  bot: boolean;
}

export function describeAgent(userAgent: string | null): AgentDescription {
  const ua = userAgent ?? '';
  const bot = BOT.test(ua);
  // Order matters: Edge and Opera also say Chrome, Chrome also says Safari
  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : null;
  const os =
    /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  return { browser, os, bot };
}

/** "Chrome on Windows", "a bot", or "Unknown browser". */
export function agentLabel(userAgent: string | null): string {
  const { browser, os, bot } = describeAgent(userAgent);
  if (bot) return 'Bot or script';
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown browser';
}

/** "London, ENG, GB", with whatever parts are known; "Unknown" for none. */
export function locationLabel(visit: Pick<BlogVisit, 'city' | 'region' | 'country'>): string {
  return [visit.city, visit.region, visit.country].filter(Boolean).join(', ') || 'Unknown';
}

/** Where the visitor came from, shortened: "the directory", another page of this site, or the other site's host. */
export function referrerLabel(referrer: string | null, ownOrigin: string | null): string {
  if (!referrer) return '—';
  try {
    const url = new URL(referrer);
    if (ownOrigin && url.origin === ownOrigin) return url.pathname === '/blog' ? 'The directory' : url.pathname;
    return url.host;
  } catch {
    return '—';
  }
}

// ─── Summing up ───────────────────────────────────────────────────────────────

export interface VisitSummary {
  views: number;
  /** Distinct addresses: an upper bound on people, since one person can use several. */
  addresses: number;
  bots: number;
}

/** Views by others (not the author) in the last `days` days. */
export function summarizeVisits(visits: readonly BlogVisit[], { now = new Date(), days }: { now?: Date; days: number }): VisitSummary {
  const since = now.getTime() - days * 86_400_000;
  const recent = visits.filter(v => v.viewer === 'visitor' && Date.parse(v.at) >= since);
  return {
    views: recent.length,
    addresses: new Set(recent.map(v => v.ip).filter(Boolean)).size,
    bots: recent.filter(v => describeAgent(v.userAgent).bot).length,
  };
}
