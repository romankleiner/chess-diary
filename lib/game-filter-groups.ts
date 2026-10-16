/**
 * The journal's game filter, as the groups of its dropdown: the games still being
 * played, then the finished ones by the month they ended, newest first. Each game
 * is named by its opponent and the colour I played, and a finished one also by the
 * day it ended and its result: most opponents have been played more than once, so
 * "romank66 vs X" alone can't tell their games apart. Pure and browser-safe.
 */
import { isGameOver } from './game-status';

export interface FilterGame {
  id: string;
  opponent: string;
  white: string;
  black: string;
  result: string | null;
  /** YYYY-MM-DD; for a finished game, the day it ended */
  date?: string;
  turn?: string;
  /** Unix time the next move is due */
  move_by?: number;
}

export interface FilterOption { id: string; label: string }
export interface FilterGroup { label: string; options: FilterOption[] }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RESULT_WORD: Record<string, string> = { win: 'Won', loss: 'Lost', draw: 'Draw' };

/** Year, month (1-12) and day of a YYYY-MM-DD date, read as written (no time zone shift), or null. */
function dateParts(date: string | undefined): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { year, month, day } : null;
}

/** The colour I played, or null without my username. */
function myColour(game: FilterGame, username: string): 'white' | 'black' | null {
  if (!username) return null;
  return game.white.toLowerCase() === username.toLowerCase() ? 'white' : 'black';
}

/**
 * "vs X · as White": the colour tells apart games against one opponent played at
 * the same time (a pair of games started together, one with each colour).
 */
function vs(game: FilterGame, username: string): string {
  const colour = myColour(game, username);
  return `vs ${game.opponent}${colour ? ` · as ${colour === 'white' ? 'White' : 'Black'}` : ''}`;
}

/**
 * The dropdown's groups for these games (the ones with journal entries). Games
 * still being played come first, the one whose move is due soonest at the top,
 * marked "your move" when it is. Finished games follow by month, newest first;
 * one whose date can't be read goes last, under "Date unknown".
 */
export function gameFilterGroups(games: readonly FilterGame[], username: string): FilterGroup[] {
  const groups: FilterGroup[] = [];

  const active = games
    .filter(g => !isGameOver(g.result))
    .sort((a, b) => {
      if (!a.move_by && !b.move_by) return a.opponent.localeCompare(b.opponent);
      if (!a.move_by) return 1;
      if (!b.move_by) return -1;
      return a.move_by - b.move_by;
    });
  if (active.length > 0) {
    groups.push({
      label: 'Active games',
      options: active.map(g => ({ id: g.id, label: `${vs(g, username)}${g.turn === myColour(g, username) ? ' · your move' : ''}` })),
    });
  }

  const finished = games
    .filter(g => isGameOver(g.result))
    .map(g => ({ game: g, when: dateParts(g.date) }))
    .sort((a, b) => {
      if (!a.when || !b.when) return a.when ? -1 : b.when ? 1 : a.game.opponent.localeCompare(b.game.opponent);
      return (b.game.date as string).localeCompare(a.game.date as string) || b.game.id.localeCompare(a.game.id);
    });

  const undated: FilterOption[] = [];
  for (const { game, when } of finished) {
    const result = RESULT_WORD[game.result as string] ?? game.result;
    if (!when) {
      undated.push({ id: game.id, label: `${vs(game, username)} · ${result}` });
      continue;
    }
    const label = `${MONTHS[when.month - 1]} ${when.year}`;
    const option = { id: game.id, label: `${vs(game, username)} · ${when.day} ${MONTHS[when.month - 1].slice(0, 3)} · ${result}` };
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.options.push(option);
    else groups.push({ label, options: [option] });
  }
  if (undated.length > 0) groups.push({ label: 'Date unknown', options: undated });

  return groups;
}
