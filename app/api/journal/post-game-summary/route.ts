import { NextRequest, NextResponse } from 'next/server';
import { getJournal, getGame, getAnalysis, getSetting, saveJournalEntry, getJournalEntry } from '@/lib/db';

function getLocalTimestamp(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localTime = new Date(now.getTime() - offset);
  return localTime.toISOString().slice(0, -1);
}

// GET: Check if a post-game summary exists for a gameId
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get('gameId');

    if (!gameId) {
      return NextResponse.json({ error: 'gameId required' }, { status: 400 });
    }

    // Still needs full journal scan — no secondary index for entryType+gameId
    const entries = await getJournal();

    const summary = entries.find(
      (e: any) => e.entryType === 'post_game_summary' && e.gameId === gameId
    );

    return NextResponse.json({ summary: summary || null });
  } catch (error) {
    console.error('Error fetching post-game summary:', error);
    return NextResponse.json({ error: 'Failed to fetch summary' }, { status: 500 });
  }
}

// POST: Create a new post-game summary
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, reflections } = body;

    if (!gameId) {
      return NextResponse.json({ error: 'gameId required' }, { status: 400 });
    }

    const [journalEntries, game, gameAnalysis, username] = await Promise.all([
      getJournal(),  // needed for duplicate check
      getGame(gameId),
      getAnalysis(gameId),
      getSetting('chesscomUsername'),
    ]);

    // Prevent duplicates
    const existing = journalEntries.find(
      (e: any) => e.entryType === 'post_game_summary' && e.gameId === gameId
    );
    if (existing) {
      return NextResponse.json(
        { error: 'Post-game summary already exists for this game' },
        { status: 409 }
      );
    }

    const statistics = gameAnalysis
      ? computeStatistics(gameAnalysis, username?.toLowerCase() || '')
      : null;

    const today = new Date().toISOString().split('T')[0];

    const entry = {
      id: Date.now(),
      timestamp: getLocalTimestamp(),
      date: today,
      gameId,
      entryType: 'post_game_summary',
      content: reflections?.lessonsLearned || reflections?.whatWentWell || '',
      postGameSummary: {
        statistics,
        reflections: {
          whatWentWell: reflections?.whatWentWell || '',
          mistakes: reflections?.mistakes || '',
          lessonsLearned: reflections?.lessonsLearned || '',
          nextSteps: reflections?.nextSteps || '',
        },
      },
      gameSnapshot: game
        ? {
            opponent: game.opponent,
            result: game.result,
            date: game.date,
            white: game.white,
            black: game.black,
            url: game.url || null,
          }
        : null,
    };

    await saveJournalEntry(entry);

    return NextResponse.json({ success: true, entry });
  } catch (error) {
    console.error('Error creating post-game summary:', error);
    return NextResponse.json({ error: 'Failed to create summary' }, { status: 500 });
  }
}

// PUT: Update reflections on an existing post-game summary
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, reflections } = body;

    if (!id) {
      return NextResponse.json({ error: 'Entry id required' }, { status: 400 });
    }

    const entry = await getJournalEntry(id);

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    entry.postGameSummary.reflections = {
      ...entry.postGameSummary.reflections,
      ...reflections,
    };
    entry.content =
      reflections?.lessonsLearned ||
      reflections?.whatWentWell ||
      entry.content;

    await saveJournalEntry(entry);

    return NextResponse.json({ success: true, entry });
  } catch (error) {
    console.error('Error updating post-game summary:', error);
    return NextResponse.json({ error: 'Failed to update summary' }, { status: 500 });
  }
}

// Compute statistics for only the user's moves.
//
// game_analyses stores:
//   whitePlayer, blackPlayer   — Chess.com usernames
//   whiteAccuracy, blackAccuracy — per-side accuracy (0-100)
//   moves[]                    — each move has { color: 'white'|'black', centipawnLoss, moveQuality }
//
// We match username against whitePlayer to determine the user's color,
// then filter moves to only that color before counting mistakes.
function computeStatistics(gameAnalysis: any, username: string) {
  if (!gameAnalysis?.moves) return null;

  // Determine which color the user played
  const userColor: 'white' | 'black' =
    gameAnalysis.whitePlayer?.toLowerCase() === username ? 'white' : 'black';

  // Pick the pre-computed per-side accuracy stored by the analyze route
  const accuracy: number | null =
    userColor === 'white'
      ? gameAnalysis.whiteAccuracy ?? null
      : gameAnalysis.blackAccuracy ?? null;

  // Filter to only the user's moves
  const userMoves: any[] = gameAnalysis.moves.filter(
    (m: any) => m.color === userColor
  );

  const totalMoves = userMoves.length;
  let blunders = 0, mistakes = 0, inaccuracies = 0;
  let totalCentipawnLoss = 0, movesWithEval = 0;

  for (const move of userMoves) {
    const quality: string = move.moveQuality || move.quality || '';
    if (quality === 'blunder') blunders++;
    else if (quality === 'mistake') mistakes++;
    else if (quality === 'inaccuracy') inaccuracies++;

    if (typeof move.centipawnLoss === 'number') {
      totalCentipawnLoss += move.centipawnLoss;
      movesWithEval++;
    }
  }

  const averageCentipawnLoss =
    movesWithEval > 0 ? Math.round(totalCentipawnLoss / movesWithEval) : null;

  return {
    totalMoves,
    accuracy,
    blunders,
    mistakes,
    inaccuracies,
    averageCentipawnLoss,
  };
}
