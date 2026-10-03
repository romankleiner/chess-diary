/**
 * Verifies the move sequences in an AI-written analysis against the rules of
 * chess — pure, no I/O, never throws.
 *
 * The analysis prompt asks the model to wrap every specific move or variation
 * it proposes in a `[[line: Nxe5 Nxe5 d4]]` marker. After the model answers,
 * verifyAndClean() replays each marker from the position's FEN with chess.js:
 * legal lines are rewritten in canonical SAN (the marker brackets disappear),
 * illegal ones are collected so the caller can send the model a correction
 * and, if it still fails, are replaced by a short placeholder.
 */
import { Chess } from 'chess.js';
import {
  fenAfterMove,
  formatSanLine,
  isValidFen,
  normalizeMoveToken,
  tryMove,
} from './position-facts';

const MARKER_RE = /\[\[\s*line\s*:\s*([\s\S]*?)\]\]/gi;
const STRAY_MARKER_RE = /\[\[\s*line\s*:?\s*|\]\]/gi;
const RESULT_RE = /^(1-0|0-1|1\/2-1\/2|\*)$/;
const MAX_LEGAL_LISTED = 60;

export const INVALID_LINE_PLACEHOLDER = '[illegal line removed]';

export interface LineCheck {
  /** Text between the marker brackets, as the model wrote it. */
  raw: string;
  valid: boolean;
  /** Canonical SAN of the legal part of the line (all of it when valid). */
  sans: string[];
  /** FEN the line was replayed from (the base position, or the one after the move played). */
  startFen: string;
  // Only set when the line is invalid:
  failedToken?: string;
  /** 0-based index of the failing move within the line. */
  failedAtPly?: number;
  fenAtFailure?: string;
  legalAtFailure?: string[];
}

export interface VerifyResult {
  /** The analysis with every marker resolved: canonical SAN, or the placeholder. */
  text: string;
  checks: LineCheck[];
  invalid: LineCheck[];
}

/** Split the inside of a marker into bare move tokens: drops move numbers, results, punctuation. */
export function tokenizeLine(text: string): string[] {
  return text
    .replace(/…/g, '...')
    .replace(/→|⇒|->/g, ' ')
    .replace(/[,;]/g, ' ')
    .split(/\s+/)
    .map(token => normalizeMoveToken(token.replace(/^\d+\.{1,3}/, '')))
    .filter(token => token !== '' && !/^\d+$/.test(token) && !/^\.+$/.test(token) && !RESULT_RE.test(token));
}

function replay(startFen: string, tokens: string[], raw: string): LineCheck {
  const chess = new Chess(startFen);
  const sans: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const move = tryMove(chess, tokens[i]);
    if (!move) {
      return {
        raw,
        valid: false,
        sans,
        startFen,
        failedToken: tokens[i],
        failedAtPly: i,
        fenAtFailure: chess.fen(),
        legalAtFailure: chess.moves(),
      };
    }
    sans.push(move.san);
  }
  return { raw, valid: true, sans, startFen };
}

/**
 * Replay one line from `baseFen`. If that fails and `altStartFen` is given
 * (the position after the move the player actually made), try from there too,
 * since models sometimes start a line after the played move. `baseFen` must be valid.
 */
export function verifyLine(baseFen: string, lineText: string, altStartFen?: string | null): LineCheck {
  const tokens = tokenizeLine(lineText);
  const raw = lineText.trim();
  const primary = replay(baseFen, tokens, raw);
  if (primary.valid || !altStartFen) return primary;

  const alternate = replay(altStartFen, tokens, raw);
  if (alternate.valid) return alternate;
  // Neither works — report whichever got furthest, preferring the base position on a tie.
  return alternate.sans.length > primary.sans.length ? alternate : primary;
}

/**
 * Resolve every `[[line: ...]]` marker in `text`. With a valid `baseFen`, legal
 * lines become canonical SAN (a lone move bare, longer lines numbered) and
 * illegal ones become INVALID_LINE_PLACEHOLDER. Without one, markers are just
 * unwrapped. Text without markers is returned untouched.
 */
export function verifyAndClean(
  text: string,
  baseFen: string | null | undefined,
  movePlayed?: string | null,
): VerifyResult {
  const checks: LineCheck[] = [];
  const canVerify = isValidFen(baseFen);
  const altStartFen = canVerify && movePlayed ? fenAfterMove(baseFen, movePlayed) : null;

  const resolved = text.replace(MARKER_RE, (_match, inner: string) => {
    if (tokenizeLine(inner).length === 0) return '';
    if (!canVerify) return inner.trim();

    const check = verifyLine(baseFen as string, inner, altStartFen);
    checks.push(check);
    return check.valid ? formatSanLine(check.startFen, check.sans) : INVALID_LINE_PLACEHOLDER;
  });

  return {
    // Drop any unbalanced marker syntax the model left behind.
    text: resolved.replace(STRAY_MARKER_RE, ''),
    checks,
    invalid: checks.filter(check => !check.valid),
  };
}

/** Follow-up message asking the model to redo an analysis whose lines failed verification. */
export function buildCorrectionPrompt(invalid: LineCheck[]): string {
  const problems = invalid.map(check => {
    const moveNo = (check.failedAtPly ?? 0) + 1;
    const sideToMove = check.fenAtFailure?.split(/\s+/)[1] === 'b' ? 'Black' : 'White';
    const legal = check.legalAtFailure ?? [];
    const shown = legal.slice(0, MAX_LEGAL_LISTED).join(', ');
    const more = legal.length > MAX_LEGAL_LISTED ? ', …' : '';
    const played =
      check.sans.length > 0
        ? ` After the legal part of the line (${formatSanLine(check.startFen, check.sans, { bareSingle: false })})`
        : ' At the start of the line';

    return (
      `- [[line: ${check.raw}]]: move ${moveNo} ("${check.failedToken}") is not legal.${played} ` +
      `the position is ${check.fenAtFailure} with ${sideToMove} to move. ` +
      `Legal moves there: ${legal.length > 0 ? shown + more : 'none'}.`
    );
  });

  return [
    'Some of the move sequences in your analysis are not legal chess in this position:',
    '',
    ...problems,
    '',
    'Rewrite the complete analysis with the same tone, length and structure. For each problem line, either replace it with a variation you have checked move by move against the verified position facts, or drop the move sequence and describe the idea in words. Keep the [[line: ...]] marker format for every variation you keep. Output only the revised analysis.',
  ].join('\n');
}
