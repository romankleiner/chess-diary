import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

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

    const db = await getDb() as any;
    const entries: any[] = db.journal_entries || [];

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

    const db = await getDb() as any;

    if (!db.journal_entries) {
      db.journal_entries = [];
    }

    // Prevent duplicates
    const existing = db.journal_entries.find(
      (e: any) => e.entryType === 'post_game_summary' && e.gameId === gameId
    );
    if (existing) {
      return NextResponse.json({ error: 'Post-game summary already exists for this game' }, { status: 409 });
    }

    // Pull statistics from game_analyses if available
    const gameAnalysis = db.game_analyses?.[gameId] || null;
    const statistics = gameAnalysis ? computeStatistics(gameAnalysis) : null;

    // Pull game metadata
    const game = db.games?.[gameId] || null;

    const today = new Date().toISOString().split('T')[0];

    const entry = {
      id: Date.now(),
      timestamp: getLocalTimestamp(),
      date: today,
      gameId,
      entryType: 'post_game_summary',
      content: reflections?.lessonsLearned || reflections?.whatWentWell || '',
      // Post-game specific fields
      postGameSummary: {
        statistics,
        reflections: {
          whatWentWell: reflections?.whatWentWell || '',
          mistakes: reflections?.mistakes || '',
          lessonsLearned: reflections?.lessonsLearned || '',
          nextSteps: reflections?.nextSteps || '',
        },
      },
      // Game metadata snapshot for display
	gameSnapshot: game ? {
        opponent: game.opponent,
        result: game.result,
        date: game.date,
        white: game.white,
        black: game.black,
        url: game.url || null,
      } : null,
    };

    db.journal_entries.push(entry);
    await saveDb(db);

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

    const db = await getDb() as any;
    const entryIndex = db.journal_entries.findIndex((e: any) => e.id === id);

    if (entryIndex === -1) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    db.journal_entries[entryIndex].postGameSummary.reflections = {
      ...db.journal_entries[entryIndex].postGameSummary.reflections,
      ...reflections,
    };
    db.journal_entries[entryIndex].content =
      reflections?.lessonsLearned ||
      reflections?.whatWentWell ||
      db.journal_entries[entryIndex].content;

    await saveDb(db);

    return NextResponse.json({ success: true, entry: db.journal_entries[entryIndex] });
  } catch (error) {
    console.error('Error updating post-game summary:', error);
    return NextResponse.json({ error: 'Failed to update summary' }, { status: 500 });
  }
}

// Helper: derive summary statistics from raw game_analyses data
function computeStatistics(gameAnalysis: any) {
  if (!gameAnalysis?.moves) return null;

  const moves: any[] = gameAnalysis.moves;
  const totalMoves = moves.length;

  let blunders = 0;
  let mistakes = 0;
  let inaccuracies = 0;
  let totalCentipawnLoss = 0;
  let movesWithEval = 0;

  for (const move of moves) {
    const quality = move.moveQuality || move.quality;
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

  // Use pre-computed accuracy from the analysis if available
  const accuracy =
    gameAnalysis.accuracy ??
    gameAnalysis.statistics?.accuracy ??
    (totalMoves > 0
      ? Math.round(
          ((totalMoves - blunders * 3 - mistakes * 2 - inaccuracies) / totalMoves) * 100
        )
      : null);

  return {
    totalMoves,
    accuracy,
    blunders,
    mistakes,
    inaccuracies,
    averageCentipawnLoss,
  };
}
