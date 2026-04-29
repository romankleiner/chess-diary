import { NextRequest, NextResponse } from 'next/server';
import { getGame, getJournal, getAnalysis, getSetting, saveJournalEntry } from '@/lib/db';
import { buildAnalysisPrompt } from '@/lib/analysis-prompt';

// GET endpoint to check AI thinking analysis progress
// Note: thinking_progress is not persisted in Redis; this is a placeholder
export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get('gameId');
  if (!gameId) return NextResponse.json({ current: 0, total: 0 });
  return NextResponse.json({ current: 0, total: 0 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, reanalyzeEngine, entryIndex = 0 } = body;

    if (!gameId) {
      return NextResponse.json({ error: 'Missing gameId' }, { status: 400 });
    }

    const [game, journalEntries, analysis, username, verbosity, model] = await Promise.all([
      getGame(gameId),
      getJournal(),
      getAnalysis(gameId),
      getSetting('chesscom_username'),
      getSetting('ai_analysis_verbosity'),
      getSetting('ai_model'),
    ]);

    // Check if game exists
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Get all journal entries for this game
    const gameEntries = journalEntries.filter(e => e.gameId === gameId);
    if (gameEntries.length === 0) {
      return NextResponse.json({ error: 'No journal entries found for this game' }, { status: 404 });
    }

    // Check if engine analysis exists
    const hasEngineAnalysis = !!analysis;
    if (!hasEngineAnalysis && !reanalyzeEngine) {
      return NextResponse.json({
        needsEngineAnalysis: true,
        message: 'Engine analysis required before AI analysis',
      });
    }

    // Run engine analysis if requested
    if (reanalyzeEngine && !hasEngineAnalysis) {
      // TODO: Trigger engine analysis
      // For now, return error asking user to run it separately
      return NextResponse.json(
        { error: 'Please run engine analysis first from the game page' },
        { status: 400 }
      );
    }

    // Get game info and user color
    const usernameLC = username?.toLowerCase() || '';
    const userColor: 'white' | 'black' =
      game && usernameLC && game.white.toLowerCase() === usernameLC ? 'white' : 'black';

    console.log(`[AI-ANALYSIS] User is playing ${userColor}`);

    const verbosityVal = verbosity || 'detailed';
    const modelVal = model || 'claude-sonnet-4-6';

    console.log(`[AI-ANALYSIS] Using verbosity: ${verbosityVal}, model: ${modelVal}`);

    // Process the single entry at entryIndex
    const entry = gameEntries[entryIndex];

    // Skip entries without content (advance index without doing work)
    if (!entry.content || !entry.content.trim()) {
      const completed = entryIndex + 1 >= gameEntries.length;
      return NextResponse.json({
        success: true,
        completed,
        nextEntryIndex: entryIndex + 1,
        entriesAnalyzed: entryIndex + 1,
        totalEntries: gameEntries.length,
      });
    }

    // Get position analysis if available
    let moveAnalysis = null;
    if (analysis?.moves) {
      let targetMoveNumber = entry.moveNumber;
      if (!targetMoveNumber && entry.fen) {
        const fenParts = entry.fen.split(' ');
        if (fenParts.length >= 6) {
          targetMoveNumber = parseInt(fenParts[5]);
        }
      }
      if (targetMoveNumber) {
        moveAnalysis = analysis.moves.find(
          (m: any) => m.moveNumber === targetMoveNumber && m.color === userColor
        );
        if (!moveAnalysis && entry.myMove) {
          // Fallback: match by notation instead of color to avoid returning the opponent's move
          console.log(`[AI-ANALYSIS] Could not find move ${targetMoveNumber} for ${userColor}, trying notation fallback with move "${entry.myMove}"`);
          moveAnalysis = analysis.moves.find(
            (m: any) => m.moveNumber === targetMoveNumber && m.move === entry.myMove
          );
        }
        // No blind color-agnostic fallback — better to have no engine data than the opponent's
      }
      if (moveAnalysis) {
        moveAnalysis = {
          ...moveAnalysis,
          evaluation: moveAnalysis.evaluation,
          evaluation_after:
            moveAnalysis.centipawnLoss !== undefined
              ? (moveAnalysis.evaluation - moveAnalysis.centipawnLoss) / 100
              : undefined,
        };
      }
    }

    console.log(
      `[AI-ANALYSIS] Entry ${entry.id}: moveNumber=${entry.moveNumber}, fen=${entry.fen?.substring(0, 30)}..., moveAnalysis=${!!moveAnalysis}`
    );
    if (moveAnalysis && moveAnalysis.principalVariation) {
      console.log(
        `[AI-ANALYSIS] PV type: ${typeof moveAnalysis.principalVariation}, value:`,
        moveAnalysis.principalVariation
      );
    }

    // Build PGN of moves up to this point for context
    let pgnMoves = '';
    if (entry.moveNumber) {
      const currentMoveNum = entry.moveNumber;
      const movesBefore = [...gameEntries]
        .filter(e => e.moveNumber && e.moveNumber < currentMoveNum && e.myMove)
        .sort((a, b) => (a.moveNumber || 0) - (b.moveNumber || 0));
      const pgnParts: string[] = [];
      movesBefore.forEach(prevEntry => {
        const moveNum = prevEntry.moveNumber!;
        const move = prevEntry.myMove!;
        if (userColor === 'white') {
          pgnParts.push(`${moveNum}. ${move}`);
        } else {
          pgnParts.push(`${moveNum}... ${move}`);
        }
      });
      pgnMoves = pgnParts.join(' ');
    }

    console.log(`[AI-ANALYSIS] PGN context: ${pgnMoves.substring(0, 100)}...`);

    const prompt = buildAnalysisPrompt(
      entry.content,
      entry.myMove,
      entry.fen,
      moveAnalysis,
      verbosityVal,
      pgnMoves
    );

    console.log(`\n========== AI ANALYSIS PROMPT - Entry ${entry.id} ==========`);
    console.log(prompt);
    console.log(`========== END PROMPT ==========\n`);

    const maxTokens =
      verbosityVal === 'brief'
        ? 300
        : verbosityVal === 'concise'
        ? 500
        : verbosityVal === 'detailed'
        ? 1200
        : verbosityVal === 'extensive'
        ? 2000
        : 500;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelVal,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AI-ANALYSIS] API error for entry ${entry.id}: ${response.status}`);
        console.error(`[AI-ANALYSIS] Error details:`, errorText);
        console.error(`[AI-ANALYSIS] Request was for model: ${modelVal}`);
      } else {
        const data = await response.json();
        const aiResponse = data.content[0]?.text || '';

        console.log(`[AI-ANALYSIS] Response for entry ${entry.id}:`);
        console.log(aiResponse);
        console.log('');

        entry.aiReview = {
          content: aiResponse,
          timestamp: new Date().toISOString(),
          model: modelVal,
          engineEval: moveAnalysis?.evaluation,
          engineBestMove: moveAnalysis?.best_move,
        };

        console.log(`[AI-ANALYSIS] Analyzed entry ${entry.id}`);
      }
    } catch (error) {
      console.error(`[AI-ANALYSIS] Error analyzing entry ${entry.id}:`, error);
    }

    // Save the updated entry (only aiReview was modified)
    await saveJournalEntry(entry);

    const completed = entryIndex + 1 >= gameEntries.length;

    return NextResponse.json({
      success: true,
      completed,
      nextEntryIndex: entryIndex + 1,
      entriesAnalyzed: entryIndex + 1,
      totalEntries: gameEntries.length,
    });
  } catch (error) {
    console.error('[AI-ANALYSIS] Error:', error);
    return NextResponse.json({ error: 'Failed to analyze thinking' }, { status: 500 });
  }
}

