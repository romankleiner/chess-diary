/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // Explicitly bundle the Polyglot opening book with all API routes.
    // Vercel's file-tracing won't auto-detect a runtime-computed fs path,
    // so we declare it here to ensure it's included in the function bundle.
    outputFileTracingIncludes: {
      '/api/**/*': ['./public/books/opening-book.bin'],
    },
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
