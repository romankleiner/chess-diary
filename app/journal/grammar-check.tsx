'use client';

import { useState } from 'react';

interface GrammarMatch {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: { value: string }[];
  context: {
    text: string;
    offset: number;
    length: number;
  };
  rule: {
    id: string;
    category: {
      id: string;
      name: string;
    };
  };
}

interface GrammarCheckProps {
  text: string;
  onApplyFix: (newText: string) => void;
}

export function GrammarCheck({ text, onApplyFix }: GrammarCheckProps) {
  const [matches, setMatches] = useState<GrammarMatch[]>([]);
  const [checking, setChecking] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const checkGrammar = async () => {
    if (!text.trim()) return;
    
    setChecking(true);
    setShowResults(true);
    
    try {
      // Using LanguageTool's public API with better parameters
      const params = new URLSearchParams({
        text: text,
        language: 'en-US',
        enabledOnly: 'false',
        level: 'picky',
        // Disable rules that are too strict
        disabledRules: '',
        // Enable additional categories
        enabledCategories: 'GRAMMAR,TYPOS,STYLE,PUNCTUATION,CASING,REDUNDANCY',
      });
      
      const response = await fetch('https://api.languagetool.org/v2/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: params,
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data = await response.json();
      let allMatches = data.matches || [];
      
      // Add simple client-side checks as fallback
      const clientSideMatches = performClientSideChecks(text);
      
      // Merge both sources, avoiding duplicates by position
      const combinedMatches = [...allMatches];
      for (const csMatch of clientSideMatches) {
        const isDuplicate = allMatches.some((m: GrammarMatch) => 
          Math.abs(m.offset - csMatch.offset) < 5
        );
        if (!isDuplicate) {
          combinedMatches.push(csMatch);
        }
      }
      
      setMatches(combinedMatches);
    } catch (error) {
      console.error('[Grammar Check] Error:', error);
      // On error, fall back to client-side only
      const clientSideMatches = performClientSideChecks(text);
      setMatches(clientSideMatches);
      if (clientSideMatches.length === 0) {
        alert(`Grammar check API failed. Using basic checks only.`);
      }
    } finally {
      setChecking(false);
    }
  };
  
  // Simple client-side grammar checks
  const performClientSideChecks = (text: string): GrammarMatch[] => {
    const matches: GrammarMatch[] = [];
    
    // Check for missing verb after subject
    const missingVerbPattern = /\b(This|That|These|Those|The|A|An)\s+\w+\s+(bad|good|great|terrible|awful|nice|poor)\b/gi;
    let match;
    while ((match = missingVerbPattern.exec(text)) !== null) {
      const fullMatch = match[0];
      const offset = match.index;
      matches.push({
        message: `Possible missing verb. Did you mean "${fullMatch.replace(/(bad|good|great|terrible|awful|nice|poor)/i, 'is $1')}"?`,
        shortMessage: 'Missing verb',
        offset: offset,
        length: fullMatch.length,
        replacements: [
          { value: fullMatch.replace(/(bad|good|great|terrible|awful|nice|poor)/i, 'is $1') },
          { value: fullMatch.replace(/(bad|good|great|terrible|awful|nice|poor)/i, 'was $1') },
        ],
        context: {
          text: text.substring(Math.max(0, offset - 20), Math.min(text.length, offset + fullMatch.length + 20)),
          offset: Math.min(20, offset),
          length: fullMatch.length,
        },
        rule: {
          id: 'CLIENT_MISSING_VERB',
          category: {
            id: 'GRAMMAR',
            name: 'Grammar',
          },
        },
      });
    }
    
    // Double punctuation
    const doublePunctPattern = /([,;:.])\s*\1+/g;
    while ((match = doublePunctPattern.exec(text)) !== null) {
      matches.push({
        message: `Repeated punctuation mark "${match[0]}"`,
        shortMessage: 'Repeated punctuation',
        offset: match.index,
        length: match[0].length,
        replacements: [{ value: match[1] }],
        context: {
          text: text.substring(Math.max(0, match.index - 20), Math.min(text.length, match.index + match[0].length + 20)),
          offset: Math.min(20, match.index),
          length: match[0].length,
        },
        rule: {
          id: 'CLIENT_DOUBLE_PUNCT',
          category: {
            id: 'PUNCTUATION',
            name: 'Punctuation',
          },
        },
      });
    }
    
    // Double spaces
    const doubleSpacePattern = /\s{2,}/g;
    while ((match = doubleSpacePattern.exec(text)) !== null) {
      matches.push({
        message: 'Multiple spaces',
        shortMessage: 'Extra space',
        offset: match.index,
        length: match[0].length,
        replacements: [{ value: ' ' }],
        context: {
          text: text.substring(Math.max(0, match.index - 20), Math.min(text.length, match.index + match[0].length + 20)),
          offset: Math.min(20, match.index),
          length: match[0].length,
        },
        rule: {
          id: 'CLIENT_DOUBLE_SPACE',
          category: {
            id: 'TYPOGRAPHY',
            name: 'Typography',
          },
        },
      });
    }
    
    return matches;
  };

  const applySuggestion = (match: GrammarMatch, replacement: string) => {
    const before = text.substring(0, match.offset);
    const after = text.substring(match.offset + match.length);
    const newText = before + replacement + after;
    onApplyFix(newText);
    
    // Remove this match from the list
    setMatches(matches.filter(m => m.offset !== match.offset));
  };

  const ignoreMatch = (match: GrammarMatch) => {
    setMatches(matches.filter(m => m.offset !== match.offset));
  };

  const getCategoryColor = (categoryId: string) => {
    if (categoryId.includes('TYPOS')) return 'text-red-600 dark:text-red-400';
    if (categoryId.includes('GRAMMAR')) return 'text-orange-600 dark:text-orange-400';
    if (categoryId.includes('STYLE')) return 'text-blue-600 dark:text-blue-400';
    return 'text-gray-600 dark:text-gray-400';
  };

  const getCategoryIcon = (categoryId: string) => {
    if (categoryId.includes('TYPOS')) return '✗';
    if (categoryId.includes('GRAMMAR')) return '⚠';
    if (categoryId.includes('STYLE')) return 'ℹ';
    return '•';
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={checkGrammar}
        disabled={checking || !text.trim()}
        className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {checking ? 'Checking...' : 'Check Grammar'}
      </button>

      {showResults && !checking && (
        <div className="border border-gray-300 dark:border-gray-600 rounded-md p-3 bg-gray-50 dark:bg-gray-800">
          {matches.length === 0 ? (
            <p className="text-sm text-green-600 dark:text-green-400">
              ✓ No issues found!
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                Found {matches.length} issue{matches.length !== 1 ? 's' : ''}:
              </p>
              {matches.map((match, idx) => (
                <div
                  key={idx}
                  className="border-l-2 border-gray-400 pl-3 space-y-2 text-sm"
                >
                  <div className="flex items-start gap-2">
                    <span className={getCategoryColor(match.rule.category.id)}>
                      {getCategoryIcon(match.rule.category.id)}
                    </span>
                    <div className="flex-1">
                      <p className="font-medium">{match.message}</p>
                      <p className="text-gray-600 dark:text-gray-400 text-xs mt-1">
                        "{match.context.text.substring(match.context.offset, match.context.offset + match.context.length)}"
                      </p>
                    </div>
                  </div>
                  
                  {match.replacements.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs text-gray-500">Suggestions:</span>
                      {match.replacements.slice(0, 3).map((replacement, rIdx) => (
                        <button
                          key={rIdx}
                          type="button"
                          onClick={() => applySuggestion(match, replacement.value)}
                          className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded hover:bg-green-200 dark:hover:bg-green-800"
                        >
                          {replacement.value || '(remove)'}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => ignoreMatch(match)}
                        className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                      >
                        Ignore
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
