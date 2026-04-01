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
  header: string;     // e.g. "Move 2: Nf3"
  timestamp: string;  // formatted HH:MM AM/PM
  fen: string | null;
  userColor: 'white' | 'black';
  thinking: string;
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

    const [game, journalEntries, analysis, username, model] = await Promise.all([
      getGame(gameId),
      getJournal(),
      getAnalysis(gameId),
      getSetting('chesscom_username'),
      getSetting('ai_model'),
    ]);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const modelVal = model || 'claude-sonnet-4-6';
    const usernameLC = (username || '').toLowerCase();
    const userColor: 'white' | 'black' =
      usernameLC && game.white?.toLowerCase() === usernameLC ? 'white' : 'black';

    // ── Filter & sort entries chronologically ─────────────────────────────

    const gameEntries = journalEntries
      .filter((e: any) => e.gameId === gameId)
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const summaryEntry = gameEntries.find((e: any) => e.entryType === 'post_game_summary');
    const moveEntries  = gameEntries.filter((e: any) => e.entryType !== 'post_game_summary');

    // ── Build per-entry sections (no Claude) ──────────────────────────────

    const sections: MoveSection[] = moveEntries
      .filter((e: any) => e.content?.trim())
      .map((entry: any) => {
        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        });

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

        return {
          type: 'move' as const,
          header,
          timestamp: time,
          fen:        entry.fen        ?? null,
          userColor,
          thinking:   entry.content.trim(),
          engineEval,
          aiReview:   entry.aiReview?.content  ?? null,
          postReview: entry.postReview?.content ?? null,
        };
      });

    // ── Build Claude prompt for the overall summary only ──────────────────

    let prompt =
      `Write a 150-250 word overall summary for a chess blog post about the following game.\n` +
      `Plain paragraphs only - no headers, no bullet points.\n\n` +
      `Game: ${game.white} (White) vs ${game.black} (Black)\n` +
      `Date: ${game.date}\n` +
      `Result: ${game.result} (you played as ${userColor})\n` +
      `Time control: ${game.timeControl || 'unknown'}`;

    if (analysis) {
      const acc: string[] = [];
      if (analysis.whiteAccuracy != null) acc.push(`White accuracy: ${analysis.whiteAccuracy}%`);
      if (analysis.blackAccuracy != null) acc.push(`Black accuracy: ${analysis.blackAccuracy}%`);
      if (acc.length) prompt += `\nAccuracy: ${acc.join(', ')}`;
    }

    // Include notable moments as context for Claude
    const notableMoves = sections.filter(
      s => s.engineEval && ['mistake', 'blunder', 'excellent'].includes(s.engineEval.moveQuality)
    );
    if (notableMoves.length) {
      prompt += `\n\nNotable moments:`;
      for (const s of notableMoves) {
        const snippet = s.thinking.slice(0, 120);
        prompt += `\n- ${s.header}: "${snippet}" (${s.engineEval!.moveQuality})`;
      }
    }

    if (summaryEntry?.postGameSummary?.reflections) {
      const r = summaryEntry.postGameSummary.reflections;
      prompt += `\n\nPost-game reflections:`;
      if (r.whatWentWell)   prompt += `\n- What went well: ${r.whatWentWell}`;
      if (r.mistakes)       prompt += `\n- Key mistakes: ${r.mistakes}`;
      if (r.lessonsLearned) prompt += `\n- Lessons learned: ${r.lessonsLearned}`;
      if (r.nextSteps)      prompt += `\n- Next steps: ${r.nextSteps}`;
    }

    console.log(`[BLOG-POST] Game ${gameId}: ${sections.length} sections, calling ${modelVal} for summary`);

    // ── Call Claude for the summary ───────────────────────────────────────

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      modelVal,
        max_tokens: 600,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BLOG-POST] Claude API error: ${response.status}`, errorText);
      return NextResponse.json(
        { error: `Claude API error: ${response.status}` },
        { status: 500 }
      );
    }

    const data = await response.json();
    const summary = data.content[0]?.text || '';

    console.log(`[BLOG-POST] Summary generated (${summary.length} chars) for game ${gameId}`);

    return NextResponse.json({ sections, summary, prompt, pgn: game.pgn || '', userColor });
  } catch (error) {
    console.error('[BLOG-POST] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate blog post' },
      { status: 500 }
    );
  }
}
