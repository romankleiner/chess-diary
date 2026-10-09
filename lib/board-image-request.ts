/**
 * Reading a request for a board diagram (/api/board-image?fen=...&pov=...), and
 * where its image is stored or made. Pure.
 *
 * The endpoint is public -- the blog's copied HTML embeds these addresses for
 * readers elsewhere -- so nothing in a request is trusted: the position must be
 * a real chess position and the side one of two words. Only what has been checked
 * goes into the image service's address or the storage key, so a request can't
 * steer either anywhere else.
 */
import { validateFen } from 'chess.js';

export type BoardPov = 'white' | 'black';

export interface BoardImageRequest {
  /** The full position, six fields (move counters filled in if they were left off). */
  fen: string;
  /** Placement, side to move, castling and en passant: what the picture depends on. */
  fen4: string;
  placement: string;
  turn: 'w' | 'b';
  pov: BoardPov;
}

/** No real position is anywhere near this long. */
const MAX_FEN_LENGTH = 100;

export function parseBoardImageRequest(fenParam: string | null, povParam: string | null): BoardImageRequest | { error: string } {
  const pov = povParam === null || povParam === '' ? 'white' : povParam;
  if (pov !== 'white' && pov !== 'black') return { error: 'pov must be white or black' };

  const text = (fenParam ?? '').trim();
  if (!text || text.length > MAX_FEN_LENGTH) return { error: 'A valid fen is required' };

  // Journal positions sometimes come without the move counters
  const parts = text.split(/\s+/);
  if (parts.length < 4 || parts.length > 6) return { error: 'That is not a valid position' };
  const full = [...parts, '0', '1'].slice(0, 6);
  if (parts.length === 5) full[5] = '1';
  const fen = full.join(' ');
  if (!validateFen(fen).ok) return { error: 'That is not a valid position' };

  return { fen, fen4: full.slice(0, 4).join(' '), placement: full[0], turn: full[1] as 'w' | 'b', pov };
}

/** Where the image is kept: the same key the store has always used, so existing images are still found. */
export function boardCacheKey({ fen4, pov }: Pick<BoardImageRequest, 'fen4' | 'pov'>): string {
  return `boards/${Buffer.from(fen4).toString('base64').replace(/\//g, '_')}-${pov}.png`;
}

/**
 * The image service that draws a diagram. New images are made from it; and a
 * reader who isn't signed in, asking for one not stored yet, is sent straight
 * to it, so their browser fetches the picture and nothing is spent here. (The
 * chess-api.com renderer once used as a fallback no longer returns an image.)
 */
export function chessvisionUrl({ placement, turn, pov }: Pick<BoardImageRequest, 'placement' | 'turn' | 'pov'>): string {
  return `https://fen2image.chessvision.ai/${placement}?turn=${turn === 'b' ? 'black' : 'white'}&pov=${pov}`;
}
