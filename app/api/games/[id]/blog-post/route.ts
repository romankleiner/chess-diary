import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { Chess } from 'chess.js';
import { getGame, getJournal, getAnalysis, getSetting, getBlogOwner } from '@/lib/db';

// Resolve whose game this is without requiring the viewer to be logged in.
// A published (shared) game is readable by anyone — including signed-in users
// who aren't the author. An unpublished game is visible only to its author
// via their session, so they can preview a draft before sharing.
async function resolveBlogOwner(gameId: string): Promise<string | null> {
  const publishedOwner = await getBlogOwner(gameId);
  if (publishedOwner) return publishedOwner;
  const { userId } = await auth();
  return userId ?? null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface EngineEval {
  moveQuality: string;
  centipawnLoss: number;
  evaluation: number;        // white-POV, pawn units
  bestMoveSan: string | null; // engine's preferred move at the position, when different
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
  plyIndex: number | null;          // 0-based ply of this move in the game PGN, null if unmatched
  engineEval: EngineEval | null;
  aiReview: string | null;
  postReview: string | null;
}

// Normalise SAN for comparison: strip check/mate/annotation symbols, lower-case.
function normSan(s: string): string {
  return s.replace(/[+#?!]/g, '').trim().toLowerCase();
}

// Normalise a FEN for position comparison: piece placement, side to move and
// castling rights only (move counters and en-passant field vary by source).
function fenKey(fen: string): string {
  return fen.split(' ').slice(0, 3).join(' ');
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gameId } = await params;

    const ownerId = await resolveBlogOwner(gameId);
    if (!ownerId) {
      return NextResponse.json(
        { error: 'This blog post hasn’t been shared by its author.' },
        { status: 404 }
      );
    }

    const [game, journalEntries, analysis, username] = await Promise.all([
      getGame(gameId, ownerId),
      getJournal(ownerId),
      getAnalysis(gameId, ownerId),
      getSetting('chesscom_username', ownerId),
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

    // Parse the game PGN once so each entry can be anchored to its ply
    // (used by the client-side game walkthrough).
    let pgnSans: string[] = [];
    let pgnFenKeys: string[] = []; // pgnFenKeys[p] = position before ply p
    let pgnFens: string[] = [];     // full FENs for chess.js parsing
    try {
      if (game.pgn) {
        const chess = new Chess();
        chess.loadPgn(game.pgn);
        const verbose = chess.history({ verbose: true });
        pgnSans    = verbose.map((m: any) => m.san as string);
        pgnFenKeys = verbose.map((m: any) => fenKey(m.before as string));
        pgnFens    = verbose.map((m: any) => m.before as string);
      }
    } catch { /* unparseable PGN → sections stay unanchored */ }

    // Forward cursor for FEN-based anchoring: entries are chronological, so
    // each anchor must come after the previous one (handles repeated positions).
    let anchorCursor = 0;

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

        // Anchor the entry to its ply in the PGN. Prefer the explicit fullmove
        // number when recorded; otherwise scan forward for the entry's FEN
        // (the position the user was looking at before playing their move).
        const plyIndex = (() => {
          if (pgnSans.length === 0) return null;
          if (entry.moveNumber && notation) {
            const ply = (entry.moveNumber - 1) * 2 + (userColor === 'black' ? 1 : 0);
            if (ply >= 0 && ply < pgnSans.length && normSan(pgnSans[ply]) === normSan(notation)) {
              return ply;
            }
          }
          if (entry.fen) {
            const target = fenKey(entry.fen);
            let fenOnly: number | null = null;
            for (let p = anchorCursor; p < pgnFenKeys.length; p++) {
              if (pgnFenKeys[p] !== target) continue;
              if (!notation || normSan(pgnSans[p]) === normSan(notation)) return p;
              if (fenOnly === null) fenOnly = p;
            }
            // Position found but the recorded SAN differs (e.g. a disambiguation
            // typo like "R1c7" for "R3c7") → trust the PGN.
            return fenOnly;
          }
          return null;
        })();
        if (plyIndex !== null) anchorCursor = plyIndex + 1;

        // The PGN is authoritative about what was actually played
        const playedSan = plyIndex !== null ? pgnSans[plyIndex] : (notation || null);

        // Fullmove number: recorded on the entry, or derived from the anchor
        const moveNumber = entry.moveNumber ?? (plyIndex !== null ? Math.floor(plyIndex / 2) + 1 : null);

        const header = moveNumber
          ? (playedSan ? `Move ${moveNumber}: ${playedSan}` : `Move ${moveNumber}`)
          : entryDateLabel;

        // Match to engine analysis by fullmove number + SAN notation + color
        let engineEval: EngineEval | null = null;
        if (moveNumber && playedSan && Array.isArray(analysis?.moves)) {
          const hit = analysis.moves.find(
            (m: any) =>
              m.moveNumber === moveNumber &&
              (!m.color || m.color === userColor) &&
              typeof m.move === 'string' &&
              normSan(m.move) === normSan(playedSan)
          );
          if (hit) {
            // Convert UCI bestMove ("e2e4", "g1f3", "e7e8q") to SAN — but only
            // when the user did NOT already play the best move (centipawnLoss > 0).
            let bestMoveSan: string | null = null;
            if (
              hit.centipawnLoss > 0 &&
              typeof hit.bestMove === 'string' &&
              plyIndex !== null &&
              pgnFens[plyIndex]
            ) {
              const uci  = hit.bestMove;
              const from = uci.slice(0, 2);
              const to   = uci.slice(2, 4);
              const promo = uci.length === 5 ? uci.slice(4, 5) : undefined;
              try {
                const c = new Chess(pgnFens[plyIndex]);
                const m = c.move({ from, to, ...(promo && { promotion: promo as any }) });
                if (m) bestMoveSan = m.san;
              } catch { /* malformed bestMove → omit */ }
            }
            engineEval = {
              moveQuality:   hit.moveQuality,
              centipawnLoss: hit.centipawnLoss,
              evaluation:    hit.evaluation,
              bestMoveSan,
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
          moveNotation:     playedSan,
          opponentLastMove,
          plyIndex,
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
