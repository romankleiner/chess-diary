/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // Explicitly bundle the Polyglot opening book (69 MB) with the one route that
  // reads it, the engine analysis: Vercel's file-tracing won't auto-detect a
  // runtime-computed fs path. A key matches every route whose path contains it,
  // so the AI analysis route (analyze-thinking) is excluded again.
  outputFileTracingIncludes: {
    '/api/games/analyze': ['./public/books/opening-book.bin'],
  },
  outputFileTracingExcludes: {
    '/api/games/analyze-thinking': ['./public/books/**'],
  },
  // The blog is unlisted: ask search engines not to index it (app/blog/layout.tsx
  // says the same in the pages' <meta>). The data its pages load is covered too.
  async headers() {
    const noIndex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }];
    return [
      { source: '/blog', headers: noIndex },
      { source: '/blog/:path*', headers: noIndex },
      { source: '/api/games/:id/blog-post', headers: noIndex },
    ];
  },
}

module.exports = nextConfig
