import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, reanalyzeEngine } = body;
    
    if (!gameId) {
      return NextResponse.json({ error: 'Missing gameId' }, { status: 400 });
    }
    
    const db = await getDb();
    
    // Check if game exists
    const game = db.games[gameId];
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    
    // Get all journal entries for this game
    const gameEntries = db.journal_entries.filter(e => e.gameId === gameId);
    
    if (gameEntries.length === 0) {
      return NextResponse.json({ 
        error: 'No journal entries found for this game' 
      }, { status: 404 });
    }
    
    // Check if engine analysis exists
    const hasEngineAnalysis = !!db.game_analyses?.[gameId];
    
    if (!hasEngineAnalysis && !reanalyzeEngine) {
      return NextResponse.json({
        needsEngineAnalysis: true,
        message: 'Engine analysis required before AI analysis'
      });
    }
    
    // Run engine analysis if requested
    if (reanalyzeEngine && !hasEngineAnalysis) {
      // TODO: Trigger engine analysis
      // For now, return error asking user to run it separately
      return NextResponse.json({
        error: 'Please run engine analysis first from the game page'
      }, { status: 400 });
    }
    
    const analysis = db.game_analyses?.[gameId] || null;
    
    // Get game info and user color
    const gameInfo = db.games[gameId];
    const username = db.settings?.chesscom_username?.toLowerCase() || '';
    const userColor: 'white' | 'black' = gameInfo && username && gameInfo.white.toLowerCase() === username ? 'white' : 'black';
    
    console.log(`[AI-ANALYSIS] User is playing ${userColor}`);
    
    // Get AI settings
    const verbosity = db.settings?.ai_analysis_verbosity || 'detailed';
    const model = db.settings?.ai_model || 'claude-sonnet-4-6'; // Default to Claude Sonnet 4.6
    
    console.log(`[AI-ANALYSIS] Using verbosity: ${verbosity}, model: ${model}`);
    
    // Process each entry
    let analyzedCount = 0;
    
    for (const entry of gameEntries) {
      // Skip entries without content
      if (!entry.content || !entry.content.trim()) {
        continue;
      }
      
      // Get position analysis if available
      let moveAnalysis = null;
      if (analysis?.moves) {
        // We need to match by both move number AND color (user's color)
        // FEN format: ... <active color> ... <full move number>
        let targetMoveNumber = entry.moveNumber;
        
        if (!targetMoveNumber && entry.fen) {
          // Extract move number from FEN (last field is the full move number)
          const fenParts = entry.fen.split(' ');
          if (fenParts.length >= 6) {
            targetMoveNumber = parseInt(fenParts[5]);
          }
        }
        
        if (targetMoveNumber) {
          // Find the move matching both move number and user's color
          moveAnalysis = analysis.moves.find((m: any) => 
            m.moveNumber === targetMoveNumber && m.color === userColor
          );
          
          // If not found, try just by move number (fallback for old data)
          if (!moveAnalysis) {
            console.log(`[AI-ANALYSIS] Could not find move ${targetMoveNumber} for ${userColor}, trying fallback`);
            moveAnalysis = analysis.moves.find((m: any) => m.moveNumber === targetMoveNumber);
          }
        }
        
        // If we found move analysis, convert centipawn values to pawn units (divide by 100)
        if (moveAnalysis) {
          moveAnalysis = {
            ...moveAnalysis,
            evaluation: moveAnalysis.evaluation / 100,
            evaluation_after: moveAnalysis.centipawnLoss !== undefined 
              ? (moveAnalysis.evaluation - moveAnalysis.centipawnLoss) / 100
              : undefined,
            // Preserve all other fields including bestMove, centipawnLoss, moveQuality, etc.
          };
        }
      }
      
      console.log(`[AI-ANALYSIS] Entry ${entry.id}: moveNumber=${entry.moveNumber}, fen=${entry.fen?.substring(0, 30)}..., moveAnalysis=${!!moveAnalysis}`);
      
      if (moveAnalysis && moveAnalysis.principalVariation) {
        console.log(`[AI-ANALYSIS] PV type: ${typeof moveAnalysis.principalVariation}, value:`, moveAnalysis.principalVariation);
      }
      
      // Build AI prompt
      const prompt = buildAnalysisPrompt(
        entry.content,
        entry.myMove,
        entry.fen,
        moveAnalysis,
        verbosity
      );
      
      console.log(`\n========== AI ANALYSIS PROMPT - Entry ${entry.id} ==========`);
      console.log(prompt);
      console.log(`========== END PROMPT ==========\n`);
      
      // Set max_tokens based on verbosity
      const maxTokens = verbosity === 'brief' ? 300 :
                        verbosity === 'concise' ? 500 :
                        verbosity === 'detailed' ? 1200 :
                        verbosity === 'extensive' ? 2000 :
                        500; // default
      
      try {
        // Call Anthropic API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY || '',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: model,
            max_tokens: maxTokens,
            messages: [{
              role: 'user',
              content: prompt
            }]
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[AI-ANALYSIS] API error for entry ${entry.id}: ${response.status}`);
          console.error(`[AI-ANALYSIS] Error details:`, errorText);
          console.error(`[AI-ANALYSIS] Request was for model: ${model}`);
          continue;
        }
        
        const data = await response.json();
        const aiResponse = data.content[0]?.text || '';
        
        console.log(`[AI-ANALYSIS] Response for entry ${entry.id}:`);
        console.log(aiResponse);
        console.log('');
        
        // Save AI review to entry
        entry.aiReview = {
          content: aiResponse,
          timestamp: new Date().toISOString(),
          model: model,
          engineEval: moveAnalysis?.evaluation,
          engineBestMove: moveAnalysis?.best_move
        };
        
        analyzedCount++;
        console.log(`[AI-ANALYSIS] Analyzed entry ${entry.id}`);
        
      } catch (error) {
        console.error(`[AI-ANALYSIS] Error analyzing entry ${entry.id}:`, error);
      }
    }
    
    // Save updated entries
    await saveDb(db);
    
    return NextResponse.json({
      success: true,
      entriesAnalyzed: analyzedCount,
      totalEntries: gameEntries.length,
      message: `AI analysis complete: ${analyzedCount} entries analyzed`
    });
    
  } catch (error) {
    console.error('[AI-ANALYSIS] Error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze thinking' },
      { status: 500 }
    );
  }
}

function buildAnalysisPrompt(
  thinking: string,
  movePlayed: string | null | undefined,
  fen: string | null | undefined,
  moveAnalysis: any,
  verbosity: string = 'detailed'
): string {
  let prompt = `You are analyzing a chess player's thought process during a game.

Position (FEN): ${fen || 'Not available'}

Player's thinking: "${thinking}"`;

  if (movePlayed) {
    prompt += `\nMove played: ${movePlayed}`;
  }
  
  if (moveAnalysis) {
    prompt += `\n\nEngine analysis:`;
    if (moveAnalysis.evaluation !== undefined) {
      prompt += `\n- Position evaluation: ${moveAnalysis.evaluation > 0 ? '+' : ''}${moveAnalysis.evaluation.toFixed(2)} pawns`;
    }
    if (moveAnalysis.bestMove) {
      prompt += `\n- Engine's best move: ${moveAnalysis.bestMove}`;
      
      // Add principal variation if available
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
    if (moveAnalysis.evaluation_after !== undefined && movePlayed) {
      prompt += `\n- Evaluation after ${movePlayed}: ${moveAnalysis.evaluation_after > 0 ? '+' : ''}${moveAnalysis.evaluation_after.toFixed(2)} pawns`;
      
      const evalDiff = moveAnalysis.evaluation_after - moveAnalysis.evaluation;
      if (Math.abs(evalDiff) > 0.03) {
        prompt += ` (${evalDiff > 0 ? '+' : ''}${evalDiff.toFixed(2)} change)`;
      }
    }
    if (moveAnalysis.centipawnLoss !== undefined && moveAnalysis.centipawnLoss > 0) {
      prompt += `\n- Centipawn loss from best move: ${(moveAnalysis.centipawnLoss / 100).toFixed(2)} pawns (${moveAnalysis.moveQuality})`;
    }
  }
  
  // Different instructions based on verbosity level
  if (verbosity === 'brief') {
    prompt += `\n\nProvide a brief analysis (1-2 sentences):
Evaluate their reasoning and mention the most important thing they should learn from this position.

Be educational and encouraging, not critical.`;
  } else if (verbosity === 'detailed') {
    prompt += `\n\nProvide a detailed analysis (2-3 paragraphs):

Paragraph 1: Evaluate whether their reasoning was sound based on the actual position. Comment on what they got right.

Paragraph 2: Point out what they overlooked - tactical motifs, piece activity, pawn structure, or strategic themes. Reference specific pieces and squares.

Paragraph 3: Suggest key patterns or principles they should recognize. If the engine suggests a different move, explain the concrete chess reasons why it's superior.

Be educational and encouraging, not critical. Use chess terminology appropriately but explain advanced concepts.`;
  } else if (verbosity === 'extensive') {
    prompt += `\n\nProvide an extensive analysis (3-4 paragraphs):

Paragraph 1: Evaluate their thought process - what reasoning did they use and was it appropriate for this position type? Comment on what they got right.

Paragraph 2: Analyze the position in detail - what are the key features (pawn structure, piece placement, king safety, tactical motifs)? Reference specific pieces and squares.

Paragraph 3: Explain what they overlooked and why it matters. If the engine suggests a different move, provide a thorough explanation of why it's superior, including potential follow-up moves.

Paragraph 4: Provide broader learning points - what pattern recognition skills should they develop? What similar positions should they study? How can they improve their evaluation process?

Be educational, thorough, and encouraging. Treat this as a chess lesson, not criticism.`;
  } else {
    // Default to 'concise' or unknown verbosity
    prompt += `\n\nProvide a concise analysis (2-3 sentences):
Evaluate if their reasoning was sound, point out anything they overlooked, and note key patterns they should recognize.

Be educational and encouraging.`;
  }

  return prompt;
}