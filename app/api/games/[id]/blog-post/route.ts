import { NextRequest, NextResponse } from 'next/server';
import { getGame, getJournal, getAnalysis, getSetting } from '@/lib/db';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EngineEval {
  moveQuality: string;
  centipawnLoss: number;
  evaluation: number; // white-POV, pawn units
}

interface MoveSection {
  type: 'move';
  header: string;              // e.g. "Move 2: Nf3"
  timestamp: string;           // ISO timestamp; client formats to local time
  fen: string | null;
  userColor: 'white' | 'black';
  thinking: string;
  moveNotation: string | null;      // SAN of the move played, e.g. "Nf3"
  opponentLastMove: string | null;  // decoded display string, e.g. "Nc4 (c3-c4)"
  engineEval: EngineEval | null;
  aiReview: string | null;
  postReview: string | null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gameId } = await params;

    const [game, journalEntries, analysis, username] = await Promise.all([
      getGame(gameId),
      getJournal(),
      getAnalysis(gameId),
      getSetting('chesscom_username'),
    ]);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const usernameLC = (username || '').toLowerCase();
    const userColor: 'white' | 'black' =
      usernameLC && game.white?.toLowerCase() === usernameLC ? 'white' : 'black';

    // ── Filter & sort entries chronologically ─────────────────────────────

    const gameEntries = journalEntries
      .filter((e: any) => e.gameId === gameId)
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const summaryEntry = gameEntries.find((e: any) => e.entryType === 'post_game_summary');
    const moveEntries  = gameEntries.filter((e: any) => e.entryType !== 'post_game_summary');

    // ── Build per-entry sections ──────────────────────────────────────────

    const sections: MoveSection[] = moveEntries
      .filter((e: any) => e.content?.trim())
      .map((entry: any) => {
        const time     = entry.timestamp as string;
        const notation = entry.moveNotation || entry.myMove || '';

        // Format date as "March 10, 2026" from entry.date (YYYY-MM-DD), avoiding
        // timezone shifts by splitting manually instead of using new Date().
        const entryDateLabel = (() => {
          const d = (entry.date || entry.timestamp?.slice(0, 10) || '').split('-').map(Number);
          if (d.length !== 3 || !d[0]) return entry.date || '';
          const months = [
            'January','February','March','April','May','June',
            'July','August','September','October','November','December',
          ];
          return `${months[d[1] - 1]} ${d[2]}, ${d[0]}`;
        })();

        const header = entry.moveNumber
          ? (notation ? `Move ${entry.moveNumber}: ${notation}` : `Move ${entry.moveNumber}`)
          : entryDateLabel;

        // Match to engine analysis by fullmove number + SAN notation
        let engineEval: EngineEval | null = null;
        if (entry.moveNumber && entry.moveNotation && Array.isArray(analysis?.moves)) {
          const hit = analysis.moves.find(
            (m: any) => m.moveNumber === entry.moveNumber && m.move === entry.moveNotation
          );
          if (hit) {
            engineEval = {
              moveQuality:   hit.moveQuality,
              centipawnLoss: hit.centipawnLoss,
              evaluation:    hit.evaluation,
            };
          }
        }

        // Decode opponentLastMove from pipe format "san|from|to" → "Nc4 (c3-c4)"
        const opponentLastMove = (() => {
          const raw = entry.opponentLastMove as string | undefined;
          if (!raw) return null;
          const parts = raw.split('|');
          if (parts.length === 3) return `${parts[0]} (${parts[1]}-${parts[2]})`;
          return parts[0] || null;
        })();

        return {
          type: 'move' as const,
          header,
          timestamp: time,
          fen:              entry.fen        ?? null,
          userColor,
          thinking:         entry.content.trim(),
          moveNotation:     notation || null,
          opponentLastMove,
          engineEval,
          aiReview:         entry.aiReview?.content  ?? null,
          postReview:       entry.postReview?.content ?? null,
        };
      });

    // ── Build summary from the user's own post-game summary entry ─────────
    // No Claude call — use what the user actually wrote.

    let summary = '';
    if (summaryEntry) {
      const parts: string[] = [];

      // Free-text content (if any)
      if (summaryEntry.content?.trim()) {
        parts.push(summaryEntry.content.trim());
      }

      // Structured reflections
      const r = summaryEntry.postGameSummary?.reflections;
      if (r) {
        if (r.whatWentWell)   parts.push(`**What went well:** ${r.whatWentWell}`);
        if (r.mistakes)       parts.push(`**Key mistakes:** ${r.mistakes}`);
        if (r.lessonsLearned) parts.push(`**Lessons learned:** ${r.lessonsLearned}`);
        if (r.nextSteps)      parts.push(`**Next steps:** ${r.nextSteps}`);
      }

      summary = parts.join('\n\n');
    }

    console.log(`[BLOG-POST] Game ${gameId}: ${sections.length} sections, summary from user entry (${summary.length} chars)`);

    return NextResponse.json({
      sections,
      summary,
      pgn: game.pgn || '',
      userColor,
      gameMeta: {
        white:       game.white       || '',
        black:       game.black       || '',
        result:      game.result      ?? null,
        date:        game.date        || '',
        timeControl: game.timeControl || '',
      },
    });
  } catch (error) {
    console.error('[BLOG-POST] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate blog post' },
      { status: 500 }
    );
  }
}
