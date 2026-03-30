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

export async function fetchActiveGames(username: string): Promise<any> {
  const url = `${CHESSCOM_API_BASE}/player/${username}/games`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch active games: ${response.statusText}`);
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
  // Only process daily games
  if (!game.time_class || game.time_class !== 'daily') {
    return null;
  }

  // Handle two different formats from Chess.com API:
  // 1. Archived games: game.white = { username: "...", ... }
  // 2. Active games: game.white = "https://api.chess.com/pub/player/username"
  
  let whiteUsername: string;
  let blackUsername: string;
  
  if (typeof game.white === 'string') {
    // Active game format - extract username from URL
    whiteUsername = game.white.split('/').pop() || '';
    blackUsername = game.black.split('/').pop() || '';
  } else if (game.white && game.white.username) {
    // Archived game format - username in object
    whiteUsername = game.white.username;
    blackUsername = game.black.username;
  } else {
    // Unknown format
    return null;
  }

  if (!whiteUsername || !blackUsername) {
    return null;
  }

  const whitePlayer = whiteUsername.toLowerCase();
  const blackPlayer = blackUsername.toLowerCase();
  const opponent = whitePlayer === username.toLowerCase() 
    ? blackUsername 
    : whiteUsername;

  // For active games, use current time as date
  const gameDate = game.end_time 
    ? new Date(game.end_time * 1000).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  return {
    id: game.url.split('/').pop() || game.uuid,
    opponent,
    date: gameDate,
    result: game.end_time ? determineResult(game, username) : null,
    pgn: game.pgn || '',
    analysisCompleted: false,
    url: game.url,
    timeControl: game.time_control,
    white: whiteUsername,
    black: blackUsername,
    turn: game.turn || null,
    fen: game.fen || null,
    move_by: game.move_by || null,
  };
}

export function determineResult(game: any, username: string): string {
  // Handle both formats
  let whiteResult: string;
  let blackResult: string;
  let whiteUsername: string;
  
  if (typeof game.white === 'string') {
    whiteUsername = game.white.split('/').pop() || '';
    // Active games won't have results
    return 'draw'; // placeholder
  } else {
    whiteUsername = game.white.username;
    whiteResult = game.white.result;
    blackResult = game.black.result;
  }
  
  const isWhite = whiteUsername.toLowerCase() === username.toLowerCase();
  
  if (whiteResult === 'win') {
    return isWhite ? 'win' : 'loss';
  } else if (blackResult === 'win') {
    return isWhite ? 'loss' : 'win';
  } else {
    return 'draw';
  }
}