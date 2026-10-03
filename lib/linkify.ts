/**
 * Finding web addresses inside running prose, so they can be made into links.
 * Pure and browser-safe.
 *
 * Only http:// and https:// addresses count. Requiring the scheme keeps ordinary
 * text (a filename, "e.g.", a version number) from turning into a link, and means
 * nothing like `javascript:` or `data:` can ever be produced, whatever the
 * author -- or the AI -- wrote.
 */

export interface LinkSegment {
  text: string;
  /** The address to link to, or null for ordinary text. */
  href: string | null;
}

// A scheme, then everything up to whitespace or a character that can't be part
// of an address in prose (angle brackets and quotes mark where one ends).
const URL_RE = /https?:\/\/[^\s<>"'`‘’“”]+/gi;

// Punctuation that ends a sentence or a phrase rather than the address.
const TRAILING_PUNCTUATION = /[.,;:!?*…]$/;

// Closing brackets belong to the address only when they match one inside it,
// as in a Wikipedia address ending "_(opening)"; "(see https://x.com/a)" does not.
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

const count = (text: string, char: string) => text.split(char).length - 1;

function trimAddress(candidate: string): string {
  let url = candidate;
  for (;;) {
    const last = url[url.length - 1];
    if (last === undefined) return url;

    if (TRAILING_PUNCTUATION.test(url)) {
      url = url.slice(0, -1);
    } else if (last in CLOSERS && count(url, last) > count(url, CLOSERS[last])) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

/** True for an address with a real host, e.g. not "https://", "https://." or "https:///path". */
function isUsable(url: string): boolean {
  // The URL parser forgives extra slashes (https:///path reads as host "path"); a link should not.
  if (!/^https?:\/\/[^/?#\s]/i.test(url)) return false;
  try {
    // (The scheme needs no check here: URL_RE only ever matches http and https.)
    return /[A-Za-z0-9]/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Split `text` into ordinary text and web addresses. Joining the segments back
 * together always gives the original text; empty segments are never returned.
 */
export function splitLinks(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let cursor = 0;

  const push = (value: string, href: string | null) => {
    if (value) segments.push({ text: value, href });
  };

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const url = trimAddress(match[0]);
    if (!isUsable(url)) continue;

    push(text.slice(cursor, start), null);
    push(url, url);
    cursor = start + url.length;
  }
  push(text.slice(cursor), null);

  return segments;
}
