/**
 * AI analysis prompt builder — pure string construction, no I/O.
 * Extracted from the analyze-thinking route so it can be unit-tested.
 */
export function buildAnalysisPrompt(
  thinking: string,
  movePlayed: string | null | undefined,
  fen: string | null | undefined,
  moveAnalysis: any,
  verbosity: string = 'detailed',
  pgnMoves: string = ''
): string {
  let prompt = `You are analyzing a chess player's thought process during a game.

Position (FEN): ${fen || 'Not available'}`;

  if (pgnMoves.length > 0) {
    prompt += `\n\nGame moves so far:\n${pgnMoves}`;
  }

  prompt += `\n\nPlayer's thinking: "${thinking}"`;

  if (movePlayed) {
    prompt += `\nMove played: ${movePlayed}`;
  }

  if (moveAnalysis) {
    prompt += `\n\nEngine analysis:`;

    // evaluation_before = eval of the position the player is thinking about (before their move)
    // evaluation_after  = eval after the move is played
    // Fall back to the raw .evaluation field if the route hasn't enriched the object yet.
    const evalBefore: number | undefined =
      moveAnalysis.evaluation_before ?? moveAnalysis.evaluation;
    const evalAfter: number | undefined =
      moveAnalysis.evaluation_after ?? moveAnalysis.evaluation;

    if (evalBefore !== undefined) {
      prompt += `\n- Position evaluation: ${evalBefore > 0 ? '+' : ''}${evalBefore.toFixed(2)} pawns`;
    }
    if (moveAnalysis.bestMove) {
      prompt += `\n- Engine's best move: ${moveAnalysis.bestMove}`;
      if (moveAnalysis.principalVariation) {
        let pvMoves = '';
        if (Array.isArray(moveAnalysis.principalVariation)) {
          pvMoves = moveAnalysis.principalVariation.join(' ');
        } else if (typeof moveAnalysis.principalVariation === 'string') {
          pvMoves = moveAnalysis.principalVariation;
        }
        if (pvMoves && pvMoves.length > 0) {
          prompt += `\n- Engine's main line: ${pvMoves}`;
        }
      }
    }
    if (evalAfter !== undefined && movePlayed) {
      prompt += `\n- Evaluation after ${movePlayed}: ${evalAfter > 0 ? '+' : ''}${evalAfter.toFixed(2)} pawns`;
      if (evalBefore !== undefined) {
        const evalDiff = evalAfter - evalBefore;
        if (Math.abs(evalDiff) > 0.03) {
          prompt += ` (${evalDiff > 0 ? '+' : ''}${evalDiff.toFixed(2)} change)`;
        }
      }
    }
    if (moveAnalysis.centipawnLoss !== undefined && moveAnalysis.centipawnLoss > 0) {
      prompt += `\n- Centipawn loss from best move: ${(moveAnalysis.centipawnLoss / 100).toFixed(2)} pawns (${moveAnalysis.moveQuality})`;
    }
  }

  if (verbosity === 'brief') {
    prompt += `\n\nProvide a brief analysis (1-2 sentences): Evaluate their reasoning and mention the most important thing they should learn from this position. Be educational and encouraging, not critical.`;
  } else if (verbosity === 'detailed') {
    prompt += `\n\nProvide a detailed analysis (2-3 paragraphs): Paragraph 1: Evaluate whether their reasoning was sound based on the actual position. If game moves are shown above, consider whether they're following through on the opening/middlegame plan. Comment on what they got right. Paragraph 2: Point out what they overlooked - tactical motifs, piece activity, pawn structure, or strategic themes. Reference specific pieces and squares. If relevant, note how this position evolved from earlier moves. Paragraph 3: Suggest key patterns or principles they should recognize. If the engine suggests a different move, explain the concrete chess reasons why it's superior. Be educational and encouraging, not critical. Use chess terminology appropriately but explain advanced concepts.`;
  } else if (verbosity === 'extensive') {
    prompt += `\n\nProvide an extensive analysis (3-4 paragraphs): Paragraph 1: Evaluate their thought process - what reasoning did they use and was it appropriate for this position type? If game moves are shown above, consider whether their thinking is consistent with their opening choice and game plan. Comment on what they got right. Paragraph 2: Analyze the position in detail - what are the key features (pawn structure, piece placement, king safety, tactical motifs)? Reference specific pieces and squares. How does this position relate to the opening/middlegame that led here? Paragraph 3: Explain what they overlooked and why it matters. If the engine suggests a different move, provide a thorough explanation of why it's superior, including potential follow-up moves. Consider the broader game context when relevant. Paragraph 4: Provide broader learning points - what pattern recognition skills should they develop? What similar positions should they study? How can they improve their evaluation process? Be educational, thorough, and encouraging. Treat this as a chess lesson, not criticism.`;
  } else {
    // Default to 'concise' or unknown verbosity
    prompt += `\n\nProvide a concise analysis (2-3 sentences): Evaluate if their reasoning was sound, point out anything they overlooked, and note key patterns they should recognize. Be educational and encouraging.`;
  }

  return prompt;
}
