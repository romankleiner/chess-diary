import { NextRequest, NextResponse } from 'next/server';
import { getGame, getJournal, getAnalysis, getSetting } from '@/lib/db';

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

    // Filter journal entries for this game, sorted chronologically
    const gameEntries = journalEntries
      .filter((e: any) => e.gameId === gameId)
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Determine player color
    const usernameLC = (username || '').toLowerCase();
    const userColor: 'white' | 'black' =
      usernameLC && game.white?.toLowerCase() === usernameLC ? 'white' : 'black';

    // Build prompt
    let prompt = `You are helping a chess player write a Chess.com blog post about a specific game.

GAME METADATA
- Date: ${game.date}
- White: ${game.white} | Black: ${game.black}
- Result: ${game.result} (player was ${userColor})
- Time control: ${game.timeControl || 'unknown'}
- Chess.com link: ${game.url || 'not available'}

PGN
${game.pgn || 'Not available'}`;

    // Add analysis statistics if available
    if (analysis?.summary) {
      const s = analysis.summary;
      const parts: string[] = [];
      if (s.accuracy !== undefined && s.accuracy !== null) parts.push(`Accuracy: ${s.accuracy}%`);
      if (s.blunders !== undefined) parts.push(`Blunders: ${s.blunders}`);
      if (s.mistakes !== undefined) parts.push(`Mistakes: ${s.mistakes}`);
      if (s.inaccuracies !== undefined) parts.push(`Inaccuracies: ${s.inaccuracies}`);
      if (parts.length > 0) {
        prompt += `\n\nANALYSIS STATISTICS\n- ${parts.join(' | ')}`;
      }
    }

    // Find post-game summary entry
    const summaryEntry = gameEntries.find((e: any) => e.entryType === 'post_game_summary');
    const regularEntries = gameEntries.filter((e: any) => e.entryType !== 'post_game_summary');

    // Add journal notes if any
    if (regularEntries.length > 0) {
      prompt += `\n\nJOURNAL NOTES (chronological)`;
      for (const entry of regularEntries) {
        if (!entry.content?.trim()) continue;
        const notation = entry.moveNotation || entry.myMove || '';
        const moveLabel = entry.moveNumber
          ? (notation ? `Move ${entry.moveNumber} (${notation})` : `Move ${entry.moveNumber}`)
          : null;
        const fenTag = entry.fen ? ` [FEN: ${entry.fen}]` : '';
        if (moveLabel) {
          prompt += `\n${moveLabel}${fenTag}: ${entry.content}`;
        } else {
          prompt += `\n${entry.content}`;
        }
        if (entry.aiReview?.content) {
          prompt += `\n  → AI review: ${entry.aiReview.content}`;
        }
      }
    }

    // Add post-game reflections at the end of context (will appear at end of blog too)
    const hasReflections = !!(summaryEntry?.postGameSummary?.reflections);
    if (hasReflections) {
      const r = summaryEntry.postGameSummary.reflections;
      prompt += `\n\nPOST-GAME REFLECTIONS (use these verbatim as the closing section of the blog post)`;
      if (r.whatWentWell) prompt += `\n- What went well: ${r.whatWentWell}`;
      if (r.mistakes) prompt += `\n- Key mistakes: ${r.mistakes}`;
      if (r.lessonsLearned) prompt += `\n- Lessons learned: ${r.lessonsLearned}`;
      if (r.nextSteps) prompt += `\n- Next steps: ${r.nextSteps}`;
    }

    const displayName = username || 'I';
    prompt += `\n\n---

Write an engaging Chess.com blog post (400–600 words) about this game. Follow these rules carefully:

STRUCTURE:
- Open with a hook about the game's key moment or result
- Walk through the game move by move, using the JOURNAL NOTES as the backbone of the narrative
${hasReflections ? '- End with a closing section based on the POST-GAME REFLECTIONS — this must come last' : '- Close with lessons learned or what to work on next'}

VOICE & CONTENT:
- Write in first person from ${displayName}'s perspective
- For each journal note, quote or closely paraphrase what was actually written — do not invent new thoughts or deviate significantly from the original wording; you may clean up grammar and flow
- Use the AI review notes as supporting context, but keep the player's own words front and center
- Use a friendly, reflective tone appropriate for a chess community blog
- Do not mention that this was AI-generated

DIAGRAMS:
- Where a journal note includes a [FEN: ...] tag, place a diagram marker on its own line immediately after the paragraph about that move, using this exact format: [DIAGRAM:<fen>:${userColor}]
- Use the exact FEN string from the tag — do not modify it
- Only emit diagram markers for positions that have a [FEN: ...] tag in the journal notes

FORMAT:
- Plain paragraphs separated by blank lines (no markdown headers, no bullet points)
- Diagram markers go on their own line between paragraphs`;

    console.log(`[BLOG-POST] Generating blog post for game ${gameId} using model ${modelVal}`);
    console.log(`\n========== BLOG POST PROMPT ==========`);
    console.log(prompt);
    console.log(`========== END PROMPT ==========\n`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelVal,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BLOG-POST] API error: ${response.status}`, errorText);
      return NextResponse.json(
        { error: `Claude API error: ${response.status}` },
        { status: 500 }
      );
    }

    const data = await response.json();
    const post = data.content[0]?.text || '';

    console.log(`[BLOG-POST] Generated blog post (${post.length} chars) for game ${gameId}`);

    return NextResponse.json({ post, prompt });
  } catch (error) {
    console.error('[BLOG-POST] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate blog post' },
      { status: 500 }
    );
  }
}
