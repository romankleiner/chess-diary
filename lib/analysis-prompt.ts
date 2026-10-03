/**
 * Programmatically computed material that keeps the model from having to
 * decode the board from a FEN in its head (see lib/position-facts.ts).
 */
export interface PromptGrounding {
  /** Output of describePosition(fen): verified facts about the position. */
  positionFacts?: string;
  /** The engine's best move converted to SAN (replaces the raw UCI string). */
  engineBestMoveSan?: string;
  /** The engine's main line converted to numbered SAN (replaces the raw UCI line). */
  engineLineSan?: string;
  /** Ask the model to wrap every concrete move/variation in a [[line: ...]] marker so it can be verified. */
  requestLineMarkers?: boolean;
}

const LINE_MARKER_RULES = `

Rules for concrete moves (your analysis is checked against the rules of chess, and illegal moves are rejected):
- The FEN above is the position BEFORE the player's move; the verified facts say whose turn it is. Treat the verified position facts as ground truth: do not place a piece on a square, or call a piece attacked, defended, hanging or pinned, unless that is consistent with them.
- Wrap every specific move or variation you propose or discuss that has not already been played in the game in a marker. Write it in SAN, moves separated by spaces, starting from the position in the FEN above, for example [[line: Nxe5 Nxe5 d4]]. A single move is a marker too: [[line: Nf3]]. The [[line: ]] brackets are removed from the final text and only the moves remain, so write the surrounding sentence as if the moves were inline.
- Before writing a marker, check its first move against the legal-move list and replay the position move by move. If you are not certain a line is legal, describe the idea in words instead of giving moves.`;

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
  pgnMoves: string = '',
  grounding?: PromptGrounding
): string {
  let prompt = `You are analyzing a chess player's thought process during a game.

Position (FEN): ${fen || 'Not available'}`;

  if (grounding?.positionFacts) {
    prompt += `\n\n${grounding.positionFacts}`;
  }

  if (pgnMoves.length > 0) {
    prompt += `\n\nGame moves so far:\n${pgnMoves}`;
  }

  prompt += `\n\nPlayer's thinking: "${thinking}"`;

  if (movePlayed) {
    prompt += `\nMove played: ${movePlayed}`;
  }

  const isBookMove = moveAnalysis?.moveQuality === 'book';

  if (moveAnalysis) {
    if (isBookMove) {
      prompt += `\n\nNote: This move is an opening book move (established theory). Engine accuracy metrics are not applicable here.`;
    } else {
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
        prompt += `\n- Engine's best move: ${grounding?.engineBestMoveSan ?? moveAnalysis.bestMove}`;
        if (moveAnalysis.principalVariation) {
          let pvMoves = '';
          if (grounding?.engineLineSan) {
            pvMoves = grounding.engineLineSan;
          } else if (Array.isArray(moveAnalysis.principalVariation)) {
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
  }

  if (isBookMove) {
    if (verbosity === 'brief') {
      prompt += `\n\nThis is an opening book move, so focus on opening understanding rather than engine accuracy. Briefly comment on whether the player's stated thinking reflects good opening principles (development, center control, king safety). Be encouraging.`;
    } else if (verbosity === 'detailed') {
      prompt += `\n\nThis is an opening book move, so do not evaluate it as a tactical or strategic error — it is established theory. Write 2-3 flowing paragraphs (no labels or headers): first comment on whether the player's stated thinking aligns with the purpose of this opening move (development, center control, king safety, piece coordination); then explain what this move achieves and what plans or ideas typically follow — identifying the opening or variation by name if possible; finally suggest what the player should be thinking about as they leave the opening and enter the middlegame. Be educational and encouraging.`;
    } else if (verbosity === 'extensive') {
      prompt += `\n\nThis is an opening book move, so do not evaluate it as a tactical or strategic error — it is established theory. Write 3-4 flowing paragraphs (no labels or headers): first evaluate whether the player's stated thinking reflects an understanding of why this move is played and what they got right; then explain the opening theory behind this move in depth, identifying the opening or variation by name and describing the key ideas both sides are fighting for; then describe the typical plans and middlegame structures that arise — thematic piece manoeuvres, pawn breaks, imbalances; finally give learning suggestions on what to study and how to improve their opening thinking process. Be thorough and educational.`;
    } else {
      prompt += `\n\nThis is an opening book move. Briefly note whether the player's thinking reflects good opening principles and what this move aims to achieve. Be encouraging.`;
    }
  } else if (verbosity === 'brief') {
    prompt += `\n\nProvide a brief analysis (1-2 sentences): Evaluate their reasoning and mention the most important thing they should learn from this position. Be educational and encouraging, not critical.`;
  } else if (verbosity === 'detailed') {
    prompt += `\n\nWrite 2-3 flowing paragraphs (no labels or headers): first evaluate whether their reasoning was sound based on the actual position, considering whether they're following through on the opening/middlegame plan, and comment on what they got right; then point out what they overlooked — tactical motifs, piece activity, pawn structure, or strategic themes, referencing specific pieces and squares; finally suggest key patterns or principles they should recognise, and if the engine recommends a different move, explain the concrete chess reasons why it's superior. Be educational and encouraging, not critical. Use chess terminology appropriately but explain advanced concepts.`;
  } else if (verbosity === 'extensive') {
    prompt += `\n\nWrite 3-4 flowing paragraphs (no labels or headers): first evaluate their thought process — what reasoning did they use and was it appropriate for this position type, considering whether their thinking is consistent with their opening choice and game plan, and comment on what they got right; then analyse the position in detail — key features such as pawn structure, piece placement, king safety, and tactical motifs, referencing specific pieces and squares and relating this to how the game got here; then explain what they overlooked and why it matters, and if the engine suggests a different move provide a thorough explanation of why it's superior including potential follow-up moves; finally provide broader learning points — what pattern recognition skills to develop, what similar positions to study, and how to improve their evaluation process. Be educational, thorough, and encouraging. Treat this as a chess lesson, not criticism.`;
  } else {
    // Default to 'concise' or unknown verbosity
    prompt += `\n\nProvide a concise analysis (2-3 sentences): Evaluate if their reasoning was sound, point out anything they overlooked, and note key patterns they should recognise. Be educational and encouraging.`;
  }

  if (grounding?.requestLineMarkers) {
    prompt += LINE_MARKER_RULES;
  }

  return prompt;
}
