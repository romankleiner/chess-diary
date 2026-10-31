import React from 'react';
import { FIGURINE, splitPieces } from '@/lib/figurine';
import { splitNotation } from '@/lib/notation';

// Monospace and most text fonts have no chess symbols, and the browser's own
// fallback varies, so name fonts known to draw them well: Windows, Android and
// Linux, then macOS and iOS. `font-variant-emoji: text` keeps them out of emoji.
const FIGURINE_FONT =
  "[font-family:'Segoe_UI_Symbol','Noto_Sans_Symbols_2','Noto_Sans_Symbols','DejaVu_Sans','Apple_Symbols',sans-serif] [font-variant-emoji:text]";

/**
 * Text with the pieces of the moves in it drawn as figurines (`Nf3` → `♞f3`).
 * Moves are found the way the blog finds them in prose (splitNotation), so the
 * words around them -- or a hand-typed move that isn't one -- keep their letters.
 */
export function Figurines({ children }: { children: string }) {
  return (
    <>
      {splitNotation(children).map((segment, i) =>
        segment.kind !== 'move'
          ? <React.Fragment key={i}>{segment.text}</React.Fragment>
          : splitPieces(segment.text).map((part, j) =>
              part.piece
                ? <span key={`${i}.${j}`} data-figurine={part.piece} className={FIGURINE_FONT}>{FIGURINE[part.piece]}</span>
                : <React.Fragment key={`${i}.${j}`}>{part.text}</React.Fragment>
            )
      )}
    </>
  );
}
