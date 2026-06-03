import { NextRequest, NextResponse } from 'next/server';
import { fetchPlayerGames, fetchActiveGames, parseChessComGame } from '@/lib/chesscom';
import { getSetting, getGames, saveGame } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const includeRecent = searchParams.get('includeRecent') === 'true';
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const month = parseInt(searchParams.get('month') || (new Date().getMonth() + 1).toString());
    
    // Get username from settings
    const username = await getSetting('chesscom_username');
    
    if (!username) {
      return NextResponse.json({ error: 'Chess.com username not configured' }, { status: 400 });
    }
    
    // Build list of fetch promises (archived months + active games) and run in parallel
    const fetchPromises: Promise<any>[] = [];

    if (includeRecent) {
      const today = new Date();
      for (let i = 0; i < 3; i++) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        fetchPromises.push(
          fetchPlayerGames(username, date.getFullYear(), date.getMonth() + 1).catch(() => null)
        );
      }
    } else {
      // Always fetch current + previous month so a game completed in the last
      // days of the prior month isn't missed by a single-month fetch.
      const today = new Date();
      for (let i = 0; i < 2; i++) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        fetchPromises.push(
          fetchPlayerGames(username, date.getFullYear(), date.getMonth() + 1).catch(() => null)
        );
      }
    }

    // Active games fetched in parallel with the archived months
    fetchPromises.push(fetchActiveGames(username).catch(() => null));

    const fetchResults = await Promise.all(fetchPromises);
    const allGames: any[] = [];
    for (const data of fetchResults) {
      if (data?.games) allGames.push(...data.games);
    }

    // Parse and store games
    const games = allGames
      .map((game: any) => parseChessComGame(game, username))
      .filter((game: any): game is NonNullable<typeof game> => game !== null);

    // Deduplicate by game ID, preferring completed games (result !== null) over
    // active ones (result === null). Chess.com sometimes still lists a recently
    // finished game in the active-games endpoint while it also appears in the
    // monthly archive with the final result — without this the active version
    // (added last) would silently overwrite the completed one.
    const gameMap = new Map<string, any>();
    for (const game of games) {
      const existing = gameMap.get(game.id);
      if (!existing || (existing.result === null && game.result !== null)) {
        gameMap.set(game.id, game);
      }
    }
    const uniqueGames = Array.from(gameMap.values());
    
    // Store in database - preserve existing analysis flags.
    // Load all existing games in one Redis call instead of N individual hget calls.
    const existingGames = await getGames();
    await Promise.all(uniqueGames.map((game) => {
      const existing = existingGames[game.id];
      const merged = {
        ...game,
        analysisCompleted: existing?.analysisCompleted || game.analysisCompleted || false,
        analysisDepth:     existing?.analysisDepth,
        analysisEngine:    existing?.analysisEngine,
      };
      return saveGame(game.id, merged);
    }));
    
    return NextResponse.json({ 
      success: true, 
      newGames: uniqueGames.length, 
      games: uniqueGames 
    });
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch games' },
      { status: 500 }
    );
  }
}