import { NextRequest, NextResponse } from 'next/server';
import { getJournal, getGame, getAnalysis, getSetting, saveJournalEntry, getJournalEntry } from '@/lib/db';
import { computeStatistics } from '@/lib/analysis-utils';
import { getLocalTimestamp } from '@/lib/timestamps';

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
      getSetting('chesscom_username'),
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

