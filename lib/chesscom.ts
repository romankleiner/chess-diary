import { Game } from '@/types';

const CHESSCOM_API_BASE = 'https://api.chess.com/pub';

export async function fetchPlayerGames(username: string, year: number, month: number): Promise<any> {
  const url = `${CHESSCOM_API_BASE}/player/${username}/games/${year}/${month.toString().padStart(2, '0')}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch games: ${response.statusText}`);
  }
  
  return await response.json();
}

export async function fetchPlayerProfile(username: string): Promise<any> {
  const url = `${CHESSCOM_API_BASE}/player/${username}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch player profile: ${response.statusText}`);
  }
  
  return await response.json();
}

export function parseChessComGame(game: any, username: string): Game | null {
  // Only process daily games that are finished
  if (!game.time_class || game.time_class !== 'daily') {
    return null;
  }

  const whitePlayer = game.white.username.toLowerCase();
  const blackPlayer = game.black.username.toLowerCase();
  const opponent = whitePlayer === username.toLowerCase() 
    ? game.black.username 
    : game.white.username;

  return {
    id: game.url.split('/').pop() || game.uuid,
    opponent,
    date: new Date(game.end_time * 1000).toISOString().split('T')[0],
    result: determineResult(game, username),
    pgn: game.pgn,
    analysisCompleted: false,
    url: game.url,
    timeControl: game.time_control,
    white: game.white.username,
    black: game.black.username,
  };
}

function determineResult(game: any, username: string): string {
  const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
  
  if (game.white.result === 'win') {
    return isWhite ? 'win' : 'loss';
  } else if (game.black.result === 'win') {
    return isWhite ? 'loss' : 'win';
  } else {
    return 'draw';
  }
}
