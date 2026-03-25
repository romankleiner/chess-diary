import { NextRequest, NextResponse } from 'next/server';
import { getGames, saveGames } from '@/lib/db';

// Toggle the turn for a game (switch from white to black or vice versa)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gameId } = await params;
    
    const games = await getGames();
    const game = games[gameId];
    
    if (!game) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }
    
    // Toggle the turn
    if (game.turn === 'white') {
      game.turn = 'black';
    } else if (game.turn === 'black') {
      game.turn = 'white';
    }
    
    games[gameId] = game;
    await saveGames(games);
    
    return NextResponse.json({ success: true, turn: game.turn });
  } catch (error) {
    console.error('Error toggling game turn:', error);
    return NextResponse.json(
      { error: 'Failed to toggle game turn' },
      { status: 500 }
    );
  }
}
