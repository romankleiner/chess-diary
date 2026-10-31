import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Static markup with each figurine (♞) read back as its piece's letter (N), from
 * its data-figurine attribute. For tests about something other than how pieces are
 * drawn -- which __tests__/unit/figurine.test.tsx covers.
 */
export const renderWithLetters = (element: ReactElement): string =>
  renderToStaticMarkup(element).replace(/<span data-figurine="([KQRBN])"[^>]*>[^<]*<\/span>/g, '$1');
