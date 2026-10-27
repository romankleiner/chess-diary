import { describe, it, expect } from 'vitest';
import { blogPath, isBlogToken } from '@/lib/blog-link';

describe('isBlogToken', () => {
  it('takes 16 characters of base64url', () => {
    expect(isBlogToken('AbCdEfGhIjKlMnOp')).toBe(true);
    expect(isBlogToken('a1-_B2c3D4e5F6g7')).toBe(true);
  });

  it('never takes a chess.com game id, which is all digits, even one 16 long', () => {
    expect(isBlogToken('909813507')).toBe(false);
    expect(isBlogToken('1234567890123456')).toBe(false);
  });

  it('refuses anything else', () => {
    for (const slug of ['', 'AbCdEfGhIjKlMnO', 'AbCdEfGhIjKlMnOpQ', 'AbCdEfGh/jKlMnOp', 'AbCdEfGh+jKlMnOp', 'AbCdEfGh=jKlMnOp']) {
      expect(isBlogToken(slug)).toBe(false);
    }
    expect(isBlogToken(undefined)).toBe(false);
    expect(isBlogToken(1234)).toBe(false);
  });
});

describe('blogPath', () => {
  it('is the reader’s page for a link', () => {
    expect(blogPath('AbCdEfGhIjKlMnOp')).toBe('/blog/AbCdEfGhIjKlMnOp');
  });
});
