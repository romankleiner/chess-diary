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
}

module.exports = nextConfig
