import { NextRequest, NextResponse } from 'next/server';
import { getGame, getJournal, getAnalysis, getSetting, saveJournalEntry } from '@/lib/db';
import { buildAnalysisPrompt } from '@/lib/analysis-prompt';
import type { PromptGrounding } from '@/lib/analysis-prompt';
import { describePosition, formatSanLine, historyFromPgn, uciLineToSan } from '@/lib/position-facts';
import { buildCorrectionPrompt, verifyAndClean } from '@/lib/line-verifier';
import { Chess } from 'chess.js';
import fs from 'fs';
import path from 'path';

// A response that needs a verification retry takes two model calls.
export const maxDuration = 60;

type ChatMessage = { role: 'user' | 'assistant'; content: string };

// Sonnet 5, Fable 5 and Mythos 5 think adaptively by default (Fable/Mythos can't
// turn it off) and thinking tokens count against max_tokens, so a small
// verbosity-based limit can be eaten entirely by thinking and leave a truncated
// or empty answer. Give those models headroom on top of the verbosity limit.
const THINKING_HEADROOM_TOKENS = 6000;
function usesThinkingByDefault(model: string): boolean {
  return /^claude-(sonnet-5|fable-5|mythos-5)/.test(model);
}

/**
 * One Messages API call. Returns the response text, or null if the API returned
 * an error. Joins all text blocks rather than reading content[0], because
 * thinking models can return a thinking block first.
 */
async function callClaude(
  model: string,
  maxTokens: number,
  messages: ChatMessage[],
  entryId: string | number
): Promise<string | null> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: usesThinkingByDefault(model) ? maxTokens + THINKING_HEADROOM_TOKENS : maxTokens,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[AI-ANALYSIS] API error for entry ${entryId}: ${response.status}`);
    console.error(`[AI-ANALYSIS] Error details:`, errorText);
    console.error(`[AI-ANALYSIS] Request was for model: ${model}`);
    return null;
  }

  const data = await response.json();
  const blocks: { type?: string; text?: unknown }[] = Array.isArray(data.content) ? data.content : [];
  if (data.stop_reason === 'max_tokens') {
    console.warn(`[AI-ANALYSIS] Entry ${entryId}: response hit max_tokens and may be truncated`);
  }
  return blocks
    .map(block => block?.text)
    .filter((text): text is string => typeof text === 'string')
    .join('');
}

/**
 * Convert a SAN move to its UCI form (e.g. "g4" → "g2g4") using the position
 * FEN that precedes the move. Returns null if the move is illegal or the FEN
 * is missing/invalid.
 */
function sanToUci(fen: string | null | undefined, san: string | null | undefined): string | null {
  if (!fen || !san) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    return move ? move.from + move.to + (move.promotion ?? '') : null;
  } catch {
    return null;
  }
}

function logPromptToFile(entryId: string, prompt: string) {
  try {
    const logPath = path.join(process.cwd(), 'ai-prompt-debug.log');
    const separator = '='.repeat(60);
    const header = `\n${separator}\n[${new Date().toISOString()}] Entry: ${entryId}\n${separator}\n`;
    fs.appendFileSync(logPath, header + prompt + '\n', 'utf8');
    console.log(`[AI-ANALYSIS] Prompt logged to ai-prompt-debug.log`);
  } catch (err) {
    console.error('[AI-ANALYSIS] Failed to write prompt log:', err);
  }
}

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
    const modelVal = model || 'claude-sonnet-5';

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
        // evaluation (from DB) = eval AFTER the move, pawn units, White POV
        // centipawnLoss (from DB) = CP loss for the side that moved, in centipawns
        //
        // If the player played the engine's top move, override cpLoss to 0 —
        // small stored values are just floating-point noise from two independent
        // engine calls and should not mislead the AI.
        const uciPlayed = sanToUci(entry.fen, entry.myMove);
        const playedBestMove =
          !!uciPlayed && !!moveAnalysis.bestMove && uciPlayed === moveAnalysis.bestMove;

        const evalAfterPawns = moveAnalysis.evaluation;
        const effectiveCpLoss = playedBestMove ? 0 : (moveAnalysis.centipawnLoss ?? 0);

        // Reconstruct eval BEFORE the move (White POV, pawn units):
        //   White moved → evalBefore = evalAfter + cpLoss/100
        //   Black moved → evalBefore = evalAfter - cpLoss/100
        const evalBeforePawns =
          moveAnalysis.color === 'white'
            ? evalAfterPawns + effectiveCpLoss / 100
            : evalAfterPawns - effectiveCpLoss / 100;

        if (playedBestMove) {
          console.log(`[AI-ANALYSIS] Player played engine's top move (${entry.myMove} = ${uciPlayed}), zeroing CP loss`);
        }

        moveAnalysis = {
          ...moveAnalysis,
          centipawnLoss: effectiveCpLoss,
          evaluation_before: evalBeforePawns, // eval of position player is THINKING about
          evaluation_after: evalAfterPawns,   // eval after move is played (= stored .evaluation)
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

    // Prefer the real move history replayed from the game's PGN. The journal-derived
    // pgnMoves above only contains the player's own journaled moves (and nothing at
    // all for entries without a moveNumber), so it is the fallback.
    const historyText = historyFromPgn(game.pgn, entry.fen) ?? pgnMoves;

    console.log(`[AI-ANALYSIS] PGN context: ${historyText.substring(0, 100)}...`);

    // Layer 1 — ground the model. Instead of making it decode the board from the
    // FEN, give it facts computed with chess.js, the engine line in SAN, and ask
    // it to put every concrete variation in a [[line: ...]] marker we can verify.
    // describePosition returns null for a missing/invalid FEN, in which case we
    // fall back to the plain prompt and skip verification.
    const positionFacts = describePosition(entry.fen);
    let grounding: PromptGrounding | undefined;
    if (positionFacts) {
      const bestMove = uciLineToSan(entry.fen, moveAnalysis?.bestMove);
      const mainLine = uciLineToSan(entry.fen, moveAnalysis?.principalVariation);
      grounding = {
        positionFacts,
        engineBestMoveSan: bestMove.complete ? bestMove.sans[0] : undefined,
        engineLineSan: mainLine.complete ? formatSanLine(entry.fen, mainLine.sans) : undefined,
        requestLineMarkers: true,
      };
    }

    const prompt = buildAnalysisPrompt(
      entry.content,
      entry.myMove,
      entry.fen,
      moveAnalysis,
      verbosityVal,
      historyText,
      grounding
    );

    console.log(`\n========== AI ANALYSIS PROMPT - Entry ${entry.id} ==========`);
    console.log(prompt);
    console.log(`========== END PROMPT ==========\n`);

    if (process.env.LOG_AI_PROMPTS === '1') {
      logPromptToFile(entry.id, prompt);
    }

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
      let aiResponse = await callClaude(modelVal, maxTokens, [{ role: 'user', content: prompt }], entry.id);

      if (aiResponse !== null) {
        // Layer 2 — verify. Replay every [[line: ...]] marker with chess.js. If any
        // line is illegal, show the model exactly what failed and let it rewrite
        // once; whatever is still illegal after that is replaced by a placeholder.
        if (grounding) {
          let verified = verifyAndClean(aiResponse, entry.fen, entry.myMove);
          console.log(
            `[AI-ANALYSIS] Entry ${entry.id}: checked ${verified.checks.length} line(s), ${verified.invalid.length} illegal`
          );

          if (verified.invalid.length > 0) {
            const retryText = await callClaude(
              modelVal,
              maxTokens,
              [
                { role: 'user', content: prompt },
                { role: 'assistant', content: aiResponse },
                { role: 'user', content: buildCorrectionPrompt(verified.invalid) },
              ],
              entry.id
            );

            if (retryText !== null) {
              const retried = verifyAndClean(retryText, entry.fen, entry.myMove);
              console.log(
                `[AI-ANALYSIS] Entry ${entry.id}: retry checked ${retried.checks.length} line(s), ${retried.invalid.length} illegal`
              );
              if (retried.invalid.length <= verified.invalid.length) verified = retried;
            }
          }

          aiResponse = verified.text;
        }

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

