/**
 * The routes anyone may open without signing in (see middleware.ts, which holds
 * every other route behind Clerk). Kept here, apart from the middleware, so a
 * test can pin which routes are public.
 */
export const PUBLIC_ROUTES: string[] = [
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/board-image(.*)',
  '/api/backup/automated(.*)',
  '/api/cron/(.*)',              // Cron endpoints are authenticated via CRON_SECRET, not Clerk
  '/blog',                       // The directory of shared games
  '/blog/(.*)',                  // Public shareable blog pages
  '/api/games/(.*)/blog-post',  // Blog post generation API used by public pages
  '/api/eval(.*)',              // Engine eval of a reader's guess on public blog pages (rate limited)
];
