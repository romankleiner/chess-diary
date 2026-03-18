'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface MoveAnalysis {
  moveNumber: number;
  color: 'white' | 'black';
  move: string;
  evaluation: number;
  bestMove: string;
  centipawnLoss: number;
  moveQuality: string;
}

interface GameAnalysis {
  gameId: string;
  analyzedAt: string;
  whitePlayer: string;
  blackPlayer: string;
  whiteAccuracy: number;
  blackAccuracy: number;
  moves: MoveAnalysis[];
}

interface Game {
  id: string;
  white: string;
  black: string;
  opponent: string;
  date: string;
  result: string;
}

export default function GameAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.id as string;
  
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalysis();
  }, [gameId]);

  const loadAnalysis = async () => {
    try {
      // Load game info
      const gamesResponse = await fetch('/api/games');
      const gamesData = await gamesResponse.json();
      const gameInfo = gamesData.games.find((g: Game) => g.id === gameId);
      setGame(gameInfo);

      // Load analysis
      const analysisResponse = await fetch(`/api/games/${gameId}/analysis`);
      const analysisData = await analysisResponse.json();
      
      if (analysisData.analysis) {
        setAnalysis(analysisData.analysis);
      } else {
        alert('No analysis found for this game');
        router.push('/games');
      }
    } catch (error) {
      console.error('Error loading analysis:', error);
      alert('Failed to load analysis');
    } finally {
      setLoading(false);
    }
  };

  const getMoveQualityColor = (quality: string) => {
    switch (quality) {
      case 'excellent': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'good': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'inaccuracy': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'mistake': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'blunder': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatEval = (evaluation: number) => {
    if (Math.abs(evaluation) >= 100) {
      // Mate score
      const mateIn = evaluation > 0 ? '+M' : '-M';
      return mateIn;
    }
    // Already in pawn units
    const pawns = evaluation.toFixed(2);
    return evaluation > 0 ? `+${pawns}` : pawns;
  };

  if (loading) {
    return <div className="text-center py-8">Loading analysis...</div>;
  }

  if (!analysis || !game) {
    return <div className="text-center py-8">Analysis not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/games" className="text-blue-600 hover:underline">
          ← Back to Games
        </Link>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Game Analysis</h2>
        
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-sm text-gray-500">White</p>
            <p className="font-semibold">{game.white}</p>
            <p className="text-lg font-bold text-blue-600">Accuracy: {analysis.whiteAccuracy}%</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Black</p>
            <p className="font-semibold">{game.black}</p>
            <p className="text-lg font-bold text-blue-600">Accuracy: {analysis.blackAccuracy}%</p>
          </div>
        </div>

        <div className="text-sm text-gray-500 mb-2">
          <p>Result: <span className="font-semibold">{game.result}</span></p>
          <p>Date: {game.date}</p>
          <p>Analyzed: {new Date(analysis.analyzedAt).toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                #
              </th>
              <th colSpan={4} className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-l border-gray-300 dark:border-gray-600">
                White
              </th>
              <th colSpan={4} className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-l border-gray-300 dark:border-gray-600">
                Black
              </th>
            </tr>
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Move
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-l border-gray-300 dark:border-gray-600">
                Played
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Best
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Eval
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                CP Loss
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-l border-gray-300 dark:border-gray-600">
                Played
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Best
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Eval
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                CP Loss
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {(() => {
              // Group moves by move number
              const movesByNumber: Record<number, { white?: MoveAnalysis; black?: MoveAnalysis }> = {};
              
              analysis.moves.forEach(move => {
                if (!movesByNumber[move.moveNumber]) {
                  movesByNumber[move.moveNumber] = {};
                }
                movesByNumber[move.moveNumber][move.color] = move;
              });
              
              return Object.entries(movesByNumber).map(([moveNum, moves]) => {
                const whiteMove = moves.white;
                const blackMove = moves.black;
                
                return (
                  <tr key={moveNum}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">
                      {moveNum}.
                    </td>
                    
                    {/* White's move */}
                    {whiteMove ? (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold border-l border-gray-300 dark:border-gray-600">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${getMoveQualityColor(whiteMove.moveQuality)}`}>
                            {whiteMove.move}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {whiteMove.bestMove || '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-mono">
                          {formatEval(whiteMove.evaluation)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <span className={`font-semibold ${
                            whiteMove.centipawnLoss < 25 ? 'text-green-600' :
                            whiteMove.centipawnLoss < 50 ? 'text-blue-600' :
                            whiteMove.centipawnLoss < 100 ? 'text-yellow-600' :
                            whiteMove.centipawnLoss < 200 ? 'text-orange-600' :
                            'text-red-600'
                          }`}>
                            {whiteMove.centipawnLoss}
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 border-l border-gray-300 dark:border-gray-600"></td>
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3"></td>
                      </>
                    )}
                    
                    {/* Black's move */}
                    {blackMove ? (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold border-l border-gray-300 dark:border-gray-600">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${getMoveQualityColor(blackMove.moveQuality)}`}>
                            {blackMove.move}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {blackMove.bestMove || '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-mono">
                          {formatEval(blackMove.evaluation)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <span className={`font-semibold ${
                            blackMove.centipawnLoss < 25 ? 'text-green-600' :
                            blackMove.centipawnLoss < 50 ? 'text-blue-600' :
                            blackMove.centipawnLoss < 100 ? 'text-yellow-600' :
                            blackMove.centipawnLoss < 200 ? 'text-orange-600' :
                            'text-red-600'
                          }`}>
                            {blackMove.centipawnLoss}
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 border-l border-gray-300 dark:border-gray-600"></td>
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3"></td>
                      </>
                    )}
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-4 text-sm">
        <p className="font-semibold mb-2">Move Quality Legend:</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div><span className="px-2 py-1 rounded bg-green-100 text-green-800 text-xs">Excellent</span> ≤25 CP loss</div>
          <div><span className="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs">Good</span> ≤50 CP loss</div>
          <div><span className="px-2 py-1 rounded bg-yellow-100 text-yellow-800 text-xs">Inaccuracy</span> ≤100 CP loss</div>
          <div><span className="px-2 py-1 rounded bg-orange-100 text-orange-800 text-xs">Mistake</span> ≤200 CP loss</div>
          <div><span className="px-2 py-1 rounded bg-red-100 text-red-800 text-xs">Blunder</span> &gt;200 CP loss</div>
        </div>
      </div>
    </div>
  );
}
