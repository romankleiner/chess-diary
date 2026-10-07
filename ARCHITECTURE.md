# Chess Diary — Architecture

## Overview

Chess Diary is a **Next.js 15 (App Router)** web application for daily-chess players. It lets users record their thinking during correspondence games on Chess.com, attach notes to specific positions, get AI-powered analysis of their thought process, and export their journal to a Word document.

All data is private per authenticated user, with one exception: a game's blog the author has shared ("Share link"). A shared game's blog can be opened by anyone, and is listed in the public directory at `/blog`.

---

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.x |
| UI | React + Tailwind CSS | 19.x / 4.x |
| Language | TypeScript | 5.x |
| Auth | Clerk | 6.x |
| Database | Redis (via ioredis) | — |
| File storage | Vercel Blob | — |
| Chess engine (local) | @se-oss/stockfish | 1.x |
| Chess engine (Vercel) | chess-api.com (HTTP) | — |
| AI analysis | Anthropic Claude API | — |
| Chess logic | chess.js | 1.x |
| Board diagrams | chessvision.ai (HTTP) | — |
| Word export | docx | 9.x |
| Opening book | Polyglot binary (local file) | — |

---

## Frontend / Backend Split

Chess Diary uses Next.js's **App Router** for both frontend and backend in a single repository. There is no separate backend service.

```
Browser
  │
  │  HTTP / fetch()
  ▼
Next.js (Vercel)
  ├── app/**/page.tsx          ← React Server / Client Components (UI)
  ├── app/api/**/route.ts      ← API Route Handlers (backend logic)
  └── lib/*.ts                 ← Shared server-side modules
```

Pages are React Client Components (`'use client'`) that call API routes via `fetch()`. No server-side props or server actions are used — the pattern is a classic SPA backed by JSON API routes. The one exception is the public directory `/blog`, an async server component that reads Redis directly (see below).

---

## Frontend Pages

| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Home / dashboard |
| `/journal` | `app/journal/page.tsx` | Main journal editor — write entries, select games, view history |
| `/games` | `app/games/page.tsx` | Game list with analysis status and post-game summary forms |
| `/games/[id]` | `app/games/[id]/page.tsx` | Individual game detail and journal entries for that game |
| `/games/[id]/analysis` | `app/games/[id]/analysis/page.tsx` | Move-by-move engine analysis viewer |
| `/blog` | `app/blog/page.tsx` | **Public** directory of every shared game, newest first by month, each linking to its blog; searchable and filterable by result. A server component, read per visit |
| `/blog/[gameId]` | `app/blog/[gameId]/page.tsx` | **Public** blog of one shared game: the walkthrough where readers guess the author's moves. "← All games" returns to `/blog` |
| `/settings` | `app/settings/page.tsx` | Chess.com username, AI model, analysis depth |
| `/backups` | `app/backups/page.tsx` | Backup history, download, restore, and prune |
| `/sign-in` | `app/sign-in/[[...sign-in]]/page.tsx` | Clerk sign-in |
| `/sign-up` | `app/sign-up/[[...sign-up]]/page.tsx` | Clerk sign-up |

---

## Backend API Routes

### Games

| Method | Route | Description |
|---|---|---|
| GET | `/api/games` | List all stored games |
| POST | `/api/games/fetch` | Pull games from Chess.com API and store them |
| POST | `/api/games/start` | Record the start of a new game |
| POST | `/api/games/[id]/toggle-turn` | Toggle whose turn it is |
| GET | `/api/games/[id]/analysis` | Get saved engine analysis for a game |
| POST | `/api/games/[id]/analysis/progress` | Read/write in-progress analysis state |
| POST | `/api/games/analyze` | Run Stockfish or chess-api.com analysis on a game |
| POST | `/api/games/analyze-thinking` | Run Claude AI analysis on the player's recorded thinking |
| POST | `/api/games/[id]/blog-post` | Build the blog from analysis + journal: per-move `sections` (each with its engine check, including the engine's `topLine` in numbered SAN and the analysis `depth`), the written `summary`, the `pgn`, `analysisSummary` (both players' accuracy and move-quality counts, for the end-of-game review), and `gameMeta` with the game's `startDate` and `endDate` called out separately and each player's `whiteRating` / `blackRating` (from the PGN; `null` when it has none). Readable without sign-in once the game is shared |
| POST / DELETE | `/api/games/[id]/share` | Share the game's blog (adds it to the public index, and so to the `/blog` directory) / un-share it. Signed-in owner only; either way the directory is read afresh on its next visit |

### Journal

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/journal` | List entries (filtered by date or game) / create entry. On the way out, a post-game review saved without an eval gets one worked out from the game's analysis (`lib/review-eval.ts`), and a post-game summary shows the analysis's current accuracy rather than the figure it saved (`lib/summary-accuracy.ts`); nothing is written back |
| GET/PUT/DELETE | `/api/journal/[id]` | Read, update, or delete a single entry |
| GET | `/api/journal/export` | Export entries as JSON or .docx Word document |
| POST | `/api/journal/post-game-summary` | Create a post-game reflection entry |

### Backups

| Method | Route | Description |
|---|---|---|
| GET | `/api/backup` | Create and download a full backup |
| POST | `/api/backup/restore` | Restore database from a backup file |
| GET | `/api/backups/list` | List backups stored in Vercel Blob |
| POST | `/api/backups/prune` | Apply tiered retention policy immediately (admin only) |

### Infrastructure

| Method | Route | Description |
|---|---|---|
| GET | `/api/board-image` | Serve a cached board diagram PNG for a FEN string |
| GET/POST | `/api/settings` | Read / save user settings |
| GET | `/api/models` | Claude models available for AI analysis, fetched from Anthropic and cached (`?refresh=1` bypasses the cache) |
| GET | `/api/eval` | Engine evaluation of one position (`?fen=&depth=`), used by the public blog to rate a reader's guess. **Public** (listed in `lib/public-routes.ts`), so it validates the FEN, clamps depth to 6–18, caches, and rate-limits (30 / minute / IP → `429` + `Retry-After`) |
| GET | `/api/admin/check` | Check if current user has admin access |
| GET | `/api/cron/daily` | Daily maintenance: backup + prune + image cleanup (Vercel Cron) |

---

## Shared Library Modules (`lib/`)

### `lib/db.ts` — Database
The central data access layer. Wraps ioredis and namespaces all keys by Clerk user ID. Every read/write calls `auth()` to resolve the current user.

All data is stored in **Redis hashes** (`HSET` / `HGETALL`):

```
chess-diary:{userId}:games       — one field per gameId
chess-diary:{userId}:journal     — one field per entryId
chess-diary:{userId}:analyses    — one field per gameId
chess-diary:{userId}:settings    — one field per setting key
chess-diary:{userId}:progress:{gameId}  — string with 10-min TTL
chess-diary:admin                — string: userId of the admin user
```

Exported functions: `getGame`, `saveGame`, `deleteGame`, `getGames`, `getJournal`, `saveJournalEntry`, `deleteJournalEntry`, `getAnalysis`, `saveAnalysis`, `getAnalyses`, `getSetting`, `saveSetting`, `getSettings`, `getDb`, `saveDb`.

### `lib/chesscom.ts` — Chess.com API Client
Fetches player games from `https://api.chess.com/pub`. Handles two response formats (archived games return objects; active games return URL strings). Filters to **daily time control** games only.

Key exports: `fetchPlayerGames(username, year, month)`, `fetchActiveGames(username)`, `parseChessComGame(game, username)`.

### `lib/analysis-utils.ts` — Engine Analysis Utilities
Pure functions for processing engine output:
- `calculateAccuracy(centipawnLosses)` / `moveAccuracy(loss)` — a game's accuracy as the plain average of its moves' accuracies, each `100·exp(−(loss/100)^1.3)`, **book moves counted as perfect**. Fitted to Chess.com's own figures (see *Accuracy* below)
- `accuracyFromMoves(moves, color)` / `withCurrentAccuracy(analysis)` — work an analysis's accuracy out from its moves, whatever formula it was saved under
- `getMoveQuality(centipawnLoss, isBookMove)` — classifies moves as book / excellent / good / inaccuracy / mistake / blunder
- `normalizeCpLoss(cp)` — handles mate-score ceiling artifacts
- `summarizeAnalysis(analysis)` — both players' accuracy, average centipawn loss (book moves excluded) and how many moves fall in each of `MOVE_QUALITIES` (book, excellent, good, inaccuracy, mistake, blunder — the legend on the game's analysis page). Feeds the blog's end-of-game engine review. There is no "brilliant" category: nothing in the analysis produces one

### Accuracy — how the percentage is worked out and kept current
**The formula.** The old one (`100 − |win%(loss) − 50|`) ran a centipawn loss through a win-probability curve as if it were an evaluation, which made almost any loss look cheap: on the author's games it averaged 98.4% where Chess.com said 89.7%, and a 60-move game with a few inaccuracies read 99%. Chess.com's formula is not published, so the current one is **fitted to its figures**: its public game archive carries an `accuracies` field for reviewed games, and 74 of the author's analysed daily games had one (148 sides; 144 after setting aside two analyses from an older version with a units bug). Findings: Chess.com tracks the average centipawn **loss** (rank correlation −0.83), not the drop in win probability (−0.64; the loss already carries the position, because `normalizeCpLoss` caps it where a position is lopsided); small losses cost almost nothing and large ones a lot (exponent above 1); and opening-book moves count as perfect rather than being left out. With `ACCURACY_SCALE_CP = 100` and `ACCURACY_SHAPE = 1.3` the average miss is about 2.1 points (8.7 before), unbiased, with 89 of 144 sides within 2 points; fitted on half the games and tested on the other half it was about 2.2. A move losing 10 / 25 / 50 / 100 / 200 cp scores about 95 / 85 / 67 / 37 / 9. It was calibrated on depth 15–18 analyses, so a much shallower analysis (noisier losses) will read somewhat lower.

**Kept current, not stored.** Accuracy is derived from an analysis's moves, so a saved figure can only go stale. `getAnalysis` (one game) works it out with `withCurrentAccuracy`, so the analysis page, the blog's engine review, new post-game summaries and the debug route all show the current formula even for games analysed long ago — nothing is rewritten and no re-analysis is needed. `getAnalyses` (the whole table, which feeds backups) stays raw. New analyses save the same figure, counting book moves as perfect in both the Vercel (batched) and local-Stockfish paths.

**Saved summaries.** A post-game summary also copies the accuracy into its own statistics when written. `lib/summary-accuracy.ts` replaces that copy with the analysis's current figure for the author's side (the side the opponent didn't play, read from the summary's game snapshot — which also corrects the few summaries that had saved the opponent's figure) wherever summaries are read: `GET /api/journal` and the Word export. Nothing is written back; a summary whose side or analysis can't be determined keeps what it has.

**Caveat.** Analyses made by an old version that stored pawns where centipawns belong (two of the 74 games turned up, with losses of 0–5 cp throughout) read as near-perfect whatever the formula; re-analysing such a game fixes it.

### `lib/analysis-prompt.ts` — Claude Prompt Builder
Constructs the prompt sent to Claude for AI analysis of player thinking. Incorporates: position FEN, engine evaluation before/after, best move, principal variation, the player's recorded thought process, and game context. Adjusts wording when the move is in the opening book. An optional `PromptGrounding` argument adds the verified position facts, the engine line in SAN, and the `[[line: ...]]` marker rules described below.

### `lib/position-facts.ts` and `lib/line-verifier.ts` — Keeping AI chess commentary legal
LLMs decode a bare FEN badly, so the AI analyzer invents pieces, threats and moves. Two layers address that (both pure chess.js, no I/O):

1. **Ground the prompt** (`position-facts.ts`): `describePosition(fen)` computes side to move, an ASCII board, every piece's square, check status, all legal moves (with the checks and captures among them), and loose / under-attacked pieces. `uciLineToSan` converts the engine's UCI best move and main line to numbered SAN, and `historyFromPgn` replays the game's PGN for the true move history (the journal-derived history is only a fallback).
2. **Verify the answer** (`line-verifier.ts`): the prompt asks Claude to wrap every move or variation it proposes in `[[line: Nxe5 Nxe5 d4]]`. `verifyAndClean` replays each marker from the entry's FEN (also accepting a line that starts after the move the player made), rewrites legal lines as canonical SAN, and replaces illegal ones with `[illegal line removed]`. The route first sends Claude one correction message (`buildCorrectionPrompt`, listing the failed move and the legal alternatives); whichever attempt has fewer illegal lines is kept.

This checks *legality* (impossible moves, misplaced pieces), not *soundness* — a legal line can still be a bad idea. Entries without a valid FEN skip both layers.

### `lib/model-catalog.ts` and `lib/model-catalog-server.ts` — The AI model list
The Settings dropdown is built from Anthropic's Models API (`GET /v1/models`) instead of a hand-edited list, so a newly released model appears without a code change.

- **Server** (`model-catalog-server.ts`, behind `/api/models`): fetches every page of the list and caches it in memory for 6 hours (re-fetched on the first request after that; the Settings page's Refresh button forces it). If Anthropic can't be reached it serves the last good list marked `stale`, and only falls back to the built-in `FALLBACK_MODELS` if there has never been a successful fetch. Simultaneous requests share one fetch.
- **Shared logic** (`model-catalog.ts`): orders models newest-first by version (then release date), shows the newest of each family plus two older ones, and keeps a saved choice selectable even if it has since disappeared from the list (a saved `claude-haiku-4-5` still matches the listed `claude-haiku-4-5-20251001`).
- **The list refreshes; the selection never does.** A newer model can change cost and behaviour (e.g. a different tokenizer), so Settings only *suggests* one in the same family, and `DEFAULT_AI_MODEL` is a fixed constant rather than "latest Sonnet".
- **Thinking-token headroom.** The Models API doesn't say which models think unprompted, so the analyzer route gives known ones extra `max_tokens` up front and, for any other model, retries once with that headroom if a reply is cut off at the limit — so a model released tomorrow works without being named in the code.

### `lib/guess-eval.ts`, `lib/position-eval.ts`, `lib/position-eval-server.ts`, `lib/rate-limit.ts` — Rating a reader's guess
On the public blog, a wrong guess is rated by the engine and set beside my move and the engine's top line (`GuessEvalCard` in `components/blog-shared.tsx`). The pure logic is split from the I/O so it can be unit-tested:

- **`position-eval.ts`** (pure, browser-safe): the `PositionEval` shape (`pawns` White's point of view, `mate`, `depth`), `parseChessApiEval` (chess-api.com signals a forced mate as `eval ±100` plus a signed `mate`, which may be a string, and reports errors as HTTP 200 with `type: "error"`), `terminalEval` (a checkmated or drawn position is answered locally — the engine API returns an error for those), `formatPawns` (`+0.3`, `-M2`, `+Mate`, `Checkmate`) and `roundPawns`.
- **`guess-eval.ts`** (pure, browser-safe): `compareGuess` and `rateGuess`. Where each number comes from: the guess is evaluated live; my move's evaluation is the one stored with the blog section; the **top line is reconstructed** as my move's evaluation plus (for White) or minus (for Black) its recorded centipawn loss — the same reconstruction the AI analysis uses. If the reader plays the engine's top move the answer is that reconstructed value and no request is made. The shortfall is graded with the same `getMoveQuality` bands as my own moves, and a difference of 0.1 or less counts as "about the same" because engines wobble that much between runs.
- **Rounding must match the screen.** Comparisons are made on `roundPawns` values (`toFixed`-style), the same rounding `formatPawns` prints, so a sentence can't contradict the number beside it. (`Math.round(x * 10) / 10` does not agree at values like 0.35.)
- **`position-eval-server.ts`** (server): `getPositionEval` — terminal shortcut, then a 24 h in-memory cache (500 entries, oldest dropped first) keyed by position + depth and ignoring the move counters, with simultaneous requests for one position sharing a single engine call. Failures are never cached.
- **`rate-limit.ts`** (server): a small fixed-window limiter keyed by caller. State is per serverless instance, so the limit is approximate; it exists to stop one visitor from spending the free engine API's goodwill, not as a security boundary.
- **Depth.** The blog-post route passes the stored analysis depth through as `engineEval.depth`, and the guess is evaluated at that depth (clamped to the engine API's maximum of 18) so the numbers are comparable.
- **Caveat.** The stored evaluation and the live one can come from different engines or depths, so small differences (~0.1) are noise rather than signal. The top line inherits whatever cap `normalizeCpLoss` applied to the stored loss.
- **A guess as good as mine, or better, moves the reader on.** If the engine rates a reader's guess at least as well as my move (`comparison.vsMine` is `'better'` or `'same'` — the same judgement the card's sentence is made from, and "same" means within the engine's 0.1 noise), the card resolves as `guessed_better` or `guessed_equal`, as though they had found my move — whether or not either move is the top line. The engine's own top move is accepted at once (`guessed_best`) without a request: `rateEngineBest` rates it from the stored numbers, synchronously, so it can be scored on the spot. Because the verdict arrives after the guess, `earnsMoveOn` decides whether a late answer still applies: it must not already be solved (solving unlocks the next card, which must happen once, e.g. if the reader gave up or found my move meanwhile) and the card must still be mounted. An earlier good guess still counts if the reader has since tried another move, and the card then shows the guess that earned it. If the evaluation fails, nothing advances (and the try is given back — see scoring).

### `lib/guess-score.ts`, `components/blog-score.tsx` — Scoring the reader's guesses
Every move the reader is asked to guess is scored. The rules are constants at the top of `guess-score.ts`, and the on-page legend (`ScoreLegend`) is built from them, so the text can't drift from the rules. All of it is pure and unit-tested; the card only feeds it events.

| Outcome | Thinking hidden | After revealing my thinking |
|---|---|---|
| My move, or one the engine rates the same (within 0.1) | 100 | 50 |
| A move better than mine | 100 + bonus | 100 + bonus + 25 |
| Skip, or out of tries | 0 | 0 |

- **Better-than-mine bonus** by how far above my move the reader's move evaluates: 25 (under 0.5 pawns), 50 (under 1), 75 (under 2), 100 (2 or more, which includes a forced mate I missed or walked into). The extra 25 is for finding it *despite* having read my thinking.
- **Tries.** 3 per move; what is found is worth ×1, ×0.6, ×0.3 on the first, second, third try (the whole positive score, extras included; never a penalty). A move already tried is free and is not sent to the engine again. A guess the engine can't rate (network or API failure) gives its try back. Where the section has no engine check (about 7% of positions) a guess can't be rated, so it carries no penalty and no better-than-mine credit, but it still uses a try — otherwise there would be nothing to stop brute-forcing the move.
- **Penalties** are for a *rated* guess that is *worse than mine*, by how far it sits behind the engine's top line — the same bands as the label on the guess card (`getMoveQuality`), so card and score can't disagree: inaccuracy (more than 0.5 pawns) −10, mistake (more than 1) −20, blunder (more than 2) −30, walking into a forced mate −40 (unless the engine sees mate against the reader whatever they play). At most −60 a move. Revealing the thinking changes none of it, and a guess at least as good as mine is never penalised, however far it is from the top line (so a better move is not also called a blunder).
- **The ledger.** A move's state is a `Ledger`: its attempts (`pending` → `rated`, `unrated`, or `failed`, each remembering whether the thinking was open *when it was played*) and how the move ended (`solved` by one of them, `skipped`, or `out_of_tries`). `scorePosition(ledger)` derives the score and a line-by-line breakdown whose lines always add to the total. Because it is derived, a rating that arrives late — the engine answers after the reader has moved on — changes the score exactly as if it had arrived at once: a poor guess still costs its penalty after the move is solved or skipped (`ScoreBreakdown` says "still checking" meanwhile). A refund can renumber the tries of later guesses.
- **Running out of tries** ends the move only when every try is spent *and* every answer is in, since the last answer may yet prove good enough. `WalkthroughMoveCard.updateLedger` is the single place the ledger changes: it keeps a ref as the latest ledger (handlers and late answers would otherwise see the one from the render they were made in), and ends the move itself when `isOutOfTries` — an event, not an effect. A rating and the solve it earns are one change, so a last try that turns out good enough is never mistaken for one that ran out. While answers are outstanding and no tries are left, further guesses are refused.
- **Display.** `blog-score.tsx` is presentational: `TriesLeft` (dots), `ScoreBreakdown` (one move), `ScoreCard` (the whole game, shown once the game is played through or skipped to the end — a move still locked keeps its name masked), `ScoreLegend` (a closed `<details>` under the introduction). The sticky progress chip also shows the running total. A score is out of 100 per move (a flawless blind game) and can exceed 100%.
- **Client-side only.** The score lives in page state, like the walkthrough's progress: nothing is stored, and there is no leaderboard. The answers are in the page data anyway, so it is an honor system by design.

### `lib/blog-directory.ts`, `lib/blog-directory-server.ts`, `components/BlogDirectory.tsx`, `lib/public-routes.ts` — The public directory of games
`/blog` lists every game its author has shared, so readers can browse instead of following links one by one. The split follows the other blog modules:

- **What is listed.** Exactly the games in the public index (`chess-diary:public:blog`, written by "Share link", read by `listPublishedBlogs`). A game that isn't shared can't be opened by anyone else, so it isn't listed; un-sharing removes it. Sharing a game therefore now also *lists* it: a link given to one person is no longer the only way to find it.
- **`blog-directory.ts`** (pure, browser-safe): `buildDirectoryEntry` turns a stored game into a row — players, each player's rating (`ratingsFromPgn`), the author's side (from their Chess.com name), result (`win`/`draw`/`loss`, `null` for anything else), `inProgress` (no result yet), start and end dates (`resolveGameDates`, so a game in progress has no end date), the time control in words (`1/86400` → "1 day per move"), and how much was written (`countCommentary`: entries with something in them, plus whether there's an overall summary — the same entries the blog turns into move sections). `sortDirectory` puts the game that ended last first (an unfinished one by when it began, undated ones last, ties by start then game number), `groupByMonth` makes the headings, `filterDirectory` applies the search (either player, or the game number) and the result filter.
- **`blog-directory-server.ts`** (server): `loadBlogDirectory` reads the published index, then for each owner just their shared games (`getGamesById` — one `HMGET`, not the whole games hash with every PGN), their journal for the commentary counts, and their Chess.com name. A shared game whose record is gone is skipped. The result is cached in memory for 60 s, because counting means reading the whole journal (entries carry pasted images); the share route calls `clearBlogDirectoryCache` so a change shows at once on the instance that made it (another instance can take up to 60 s).
- **The page** (`app/blog/page.tsx`) is an async server component with `dynamic = 'force-dynamic'`: read per visit, never at build time, so the build needs no database. If the read fails it says so in an alert rather than failing the page. `BlogDirectory` is the only client part (search and filter state).
- **A row's markup.** The title (`romank66 (1523) vs opponent_a (1480)`) is the link to the blog, and its `::after` overlay (`after:absolute after:inset-0` on a `relative` `<li>`) makes the whole card clickable. A link can't contain another link, so the two Chess.com profile links live in a separate "Chess.com profiles" line, each wrapped in `relative z-10` so they sit above the overlay (the rest of that line still opens the blog).
- **Public routes** now live in `lib/public-routes.ts` (imported by `middleware.ts`) so a test can pin them. `/blog` is public alongside `/blog/(.*)`; `/blogger` and `/api/blog` are not. Note the test setup replaces Clerk's `createRouteMatcher` with a stub that matches nothing, so the test uses `createPathMatcher` from `@clerk/shared`, which it wraps.

### `lib/review-eval.ts` — The eval on a post-game review
The journal shows the engine's eval beside a post-game review ("Added 61 days after game · +0.40 · good · 25 cp"). It used to come only from a copy saved *with* the review, taken in the browser when the review was written — so it was missing whenever the game hadn't been analysed yet, the review had been edited (an edit saves a fresh review without it), or the recorded move text didn't match the analysis exactly (`0-0` for `O-O`, `Nd2` for `Nbd2`). On the author's real journal that was 234 of 724 reviews. Now `GET /api/journal` works it out from the game when it is read:

- **Anchoring.** `resolveReviewEval` finds the move an entry is about by the *position* it was written from (its FEN, ignoring move counters), because the recorded move is often missing or loosely written; with no FEN it falls back to move number + recorded move. A position reached twice is settled by the recorded move.
- **Only the move actually played.** The eval is attached only if the move the entry recorded *is* the move played there — `0-0`, check/annotation marks and an ambiguous `Nd2` for `Nbd2` all count as the same move — so an entry about a move that wasn't played gets no eval rather than another move's. An entry with no recorded move is about the move played from its position. An analysis whose move text doesn't match the game's (a stale analysis) is not trusted.
- **Read-time, not stored.** `addMissingReviewEvals` fills in only reviews that have none, leaves a saved eval alone (including `0`), skips summaries and entries with no game, loads each game once, and writes nothing back, so it also follows an analysis that is re-run later. A game that can't be loaded, or one malformed entry, only costs its own reviews' evals, and the route returns the journal as stored if anything else goes wrong.
- **Display.** `formatPawnsFine` shows two decimals but reads a mate-sized stored value (the analyses hold some ±100 and beyond) as `+Mate` instead of `+104.00`.
- The Word export doesn't show a review's eval at all (only "Added … days after game").

### `lib/game-dates.ts` — When a game started and ended
A stored game has a single `date`: the day of its last move (from Chess.com's `end_time`), or for a game still being played just the day it was fetched. A daily game can run for weeks, so the blog calls out the start and end separately (`GameDates` in `components/blog-shared.tsx`). `resolveGameDates` takes the **start** from the PGN's `[Date]` tag (falling back to `[UTCDate]`), which Chess.com sets to the day the game began — checked against real daily games, where the stored end date also equals `[EndDate]`. Tags are read from the PGN text directly (`pgnTag`), so a PGN whose moves can't be parsed still yields them. The placeholder `????.??.??` and impossible dates count as unknown, a start after the end is dropped, and an unfinished game reports no end date (its stored date isn't one). The blog shows whichever of the two is known, and nothing when neither is.

### `lib/players.ts` — Ratings and profile links
Both players are shown with their rating and a link to their Chess.com profile, in the blog's heading and the preview modal's header (`GamePlayers` / `PlayerLink` in `components/blog-shared.tsx`) and in the directory.

- **Ratings come from the PGN**, not from the stored game, which has no rating field: Chess.com writes `[WhiteElo]` and `[BlackElo]` (all 123 of the author's stored PGNs, including games still being played, have both). `ratingsFromPgn` accepts three or four digits and gives `null` for `?`, `0`, a missing tag or anything else; the blog-post route returns them as `gameMeta.whiteRating` / `blackRating`, and the directory builds them into each entry. They are the ratings as recorded in that game's PGN, so they may differ from a player's rating today.
- **Profile links** are `https://www.chess.com/member/<name>`, built by `chesscomProfileUrl`. Usernames arrive from Chess.com's API, so they are not trusted: a name is linked only if it is 1–50 characters of letters, digits, underscore or hyphen (what Chess.com allows), which also guarantees the address stays on chess.com. Anything else (a `/`, `?`, `.`, `@`, a space, non-ASCII…) is shown as plain text. Links open in a new tab with `rel="noopener noreferrer"` so a reader keeps their place in the walkthrough, and carry screen-reader text saying so; the rating is read as "rating 1523".

### `lib/linkify.ts` — Web addresses in prose
`splitLinks(text)` splits commentary into ordinary text and `http(s)://` addresses, so `renderInline` can turn them into links (new tab, `rel="noopener noreferrer"`, long addresses wrap). Addresses are split out *before* notation highlighting, so text inside one is never mistaken for a move. Only addresses with a scheme are linked — `www.…` or a bare filename are not — and only `http`/`https`, enforced at two independent points, so no `javascript:` or `data:` link can be produced whatever the author or the AI wrote. Trailing sentence punctuation is left outside the link, and a closing bracket belongs to the address only if it matches an opener inside it (`…Ruy_Lopez_(opening)` keeps its `)`; `(see https://x.com/a)` does not). A host with no letter or digit (`https://-`) is not a link.

### `lib/notation.ts` — Chess notation in prose
`splitNotation(text, options?)` splits commentary into ordinary text, chess notation and (optionally) branch labels, so the blog can set moves apart from the words around them (a monospaced, tinted chip; see `renderInline` in `components/blog-shared.tsx`). Pure and browser-safe. Each segment is `{ text, kind }` with `kind` one of `'text' | 'move' | 'branch'`; joining the segments always gives back the original text.

- **What counts as notation:** standard algebraic moves (`Nf3`, `exd5`, `Bxd2+`, `e8=Q#`, `O-O-O`) with an optional move number (`10.`, `9...`, a bare `...`) and annotation (`!?`). Moves written one after another are **one run**, so `9...Bxd2+ 10. Nxd2` is a single chip. It accepts both the author's `9...Bxd2+` and the AI's canonical `9... Bxd2+` (`formatSanLine`).
- **It is a pattern match, not a legality check.** `a4` is marked whether it is a move or a square, and look-alikes are marked too; that suits commentary, where the author is nearly always talking about the board. Words and numbers that merely resemble moves (`B2`, `1-0`, `3.5`, `e2e4`, `abc4`) are left alone.
- **No regex lookbehind.** Older Safari can't parse one, and a parse error would take down the whole public blog page; the character before a run is captured and handed back as plain text instead.
- **Branch labels (`branchLabels: true`).** When calculating, the author names the lines they are working through — `(a)`, `(a3)` (sub-variation 3 of variation a), `(b21)`, `(iii)`, or `b1)` opening a line. `(a3)` has the same shape as a pawn move and used to be chipped as one. With the option on, such a label is reported as `kind: 'branch'` and drawn as an indigo, upright, proportional-font pill (`BranchLabel`), so it reads differently from the slate monospaced move chip. Labels are found *first*, and moves are looked for only in the text between them, so nothing inside a label is ever a move. Grammar, taken from the author's real journal: a single letter `a`–`h`; a letter `a`–`e` with a rank `1`–`4`; a letter and two or more digits; roman numerals `i`–`x`. A label is a token on its own: the brackets must not run into a word before (`move(s)`, `f(a)`) or after (`(a)typical`, `(a3)Nf3`), and `(a)(b)` is two labels.
  - **Ranks 5–8 stay moves.** `(a5)`…`(a8)`, `(c5)`, `(f6)`, `(h4)` and anything with a piece or more text in the brackets (`(Nf3)`, `(a3 Nf6)`, `(O-O)`) are moves: a real square in brackets is far more likely than a fifth sub-variation. Of the bracketed squares in the author's journal, only `(f6)` was a real move, and it stays one.
  - **Author's own words only.** The option is off by default, and the blog turns it on (`AUTHOR_WORDS`) only for the author's thinking, post-game review and overall summary — never for `aiReview`. In the AI's text a lone `(e4)`, `(c5)` or `(g5)` really is a square, and would be wrongly marked as a branch.
  - **`startsLine`.** The list form `b1)` is a label only where it opens a line. `renderInline` passes `startsLine: false` for text that carries on after a bold phrase (and for the bold text itself) and for the pieces after a web address, so `**Note:** b1) go on` still treats `b1` as a move, as before. The bracketed form needs no such rule.
  - Not applied to the Word export or the copy-to-clipboard text, which have no chips.

### `lib/opening-book.ts` — Opening Book Lookup
Reads a Polyglot binary opening book from `data/opening-book.bin` using Zobrist hashing. Returns candidate moves for a position. Pure file I/O — no network calls. Used during analysis to tag book moves.

### `lib/board-image-storage.ts` — Board Diagram Cache
Two-tier caching pipeline for board diagrams:
1. Check Vercel Blob (public) by FEN-based key — return immediately if found
2. Generate image from `https://fen2image.chessvision.ai`, upload to Vercel Blob, return URL

Also handles migration of base64-encoded images in journal entries to Vercel Blob.

### `lib/backup-prune.ts` — Backup Retention Policy
Tiered deletion strategy for Vercel Blob backups:
- **Last 7 days** — keep every daily backup
- **Days 8–35** — keep the newest backup per calendar week
- **Older** — keep the newest backup per calendar month

### `lib/admin.ts` — Admin Access
The first authenticated user is automatically promoted to admin. Admin status is stored in a single Redis key (`chess-diary:admin`). Admin-only endpoints include backup management and debug routes.

### `lib/timestamps.ts`
Generates local-timezone ISO timestamps and filters journal entries by date range.

---

## Reusable Components (`components/`)

| Component | Purpose |
|---|---|
| `PostGameSummaryCard.tsx` | Collapsible card displaying a post-game reflection entry (stats grid + coloured reflection sections) |
| `PostGameSummaryForm.tsx` | Form for writing post-game reflections: "What went well", "Mistakes", "Lessons Learned", "Next Steps" |
| `BlogPostModal.tsx` | Modal for generating and viewing a game analysis as a formatted blog post |
| `BlogDirectory.tsx` | The public directory of shared games at `/blog`: games by month, each linking to its blog, with a search box and a result filter |
| `blog-score.tsx` | The scoring game's display (`TriesLeft`, `ScoreBreakdown`, `ScoreCard`, `ScoreLegend`); numbers come from `lib/guess-score.ts` |
| `blog-shared.tsx` | Types and interactive pieces shared by the modal and the public `/blog/[gameId]` page: `GameWalkthrough` (guess-the-move cards), the commentary boxes (`ThinkingBlock`, `AiAnalysisBlock`, `PostGameBlock`), `EvalCallout`, and `GuessEvalCard` (engine check of a reader's guess). `renderProse` / `renderInline` render commentary text with `**bold**`, web addresses as links, and chess notation set apart. A move has three phases (`puzzle` → optionally `thinking_shown` → `complete`); solving it — by playing my move, the engine's top move, any move the engine rates as well as or above mine, by skipping it (offered from the start), or by running out of tries — goes straight to `complete`, which shows the score breakdown, the thinking, engine check (with the engine's top line when my move wasn't its top move), AI analysis and post-game review together. At the end of the game `EngineSummaryCard` shows both players' accuracy and move-quality counts, sealed behind the same unlock as the overall summary. Step counters count whole moves (`formatMoveCount`: 16 plies read "8", an odd ply "4.5") |

### Blog layout
The public blog and the preview modal share `GameWalkthrough`, and the page is `max-w-6xl` (the modal `max-w-5xl`). Each guess card lays itself out with a **container query** (`@container` / `@4xl:` — about 896px of card width), not a viewport breakpoint, so the narrower modal adapts correctly: below that it is one column; above it the board and its controls sit on the left (28rem) and the prompts, feedback and commentary read down the right. **The board column is sticky** (`self-start`, `top-4`) so the diagram stays in view while the reader scrolls a tall right-hand column (thinking, engine check, AI and post-game commentary). Three things make that safe: the card uses `overflow-clip`, not `overflow-hidden` (hidden makes the card a scroll container, and the board would stick to the card instead of the window); sticky applies only when the window is at least 42rem tall (`[@media(min-height:42rem)]`), because a column taller than the window would leave its bottom out of reach; and, in two columns, the move list is capped at four rows (`max-h-24`) and scrolls, keeping the current move in sight as the board steps, so the column is at most about 39rem tall (28rem board, step controls, four rows of moves) however long the stretch of moves — under the 42rem guard. In one column nothing is sticky or capped. The single-column grid track is `minmax(0,1fr)` — a plain `auto` track grows to the widest control row and clips a phone-sized card. Running prose (intro, overall summary) is capped at `max-w-3xl` so lines stay readable on a wide page, and the "Unlocked" progress chip (which also carries the running score) sits at the top-right except on `2xl` screens, where the margin is wide enough to hold it beside the column.

---

## Key Architectural Patterns

### Dual-Engine Analysis
Engine analysis uses different backends depending on environment:

- **Local / non-Vercel**: Stockfish via `@se-oss/stockfish` npm package — full depth, no time limit
- **Vercel serverless**: `chess-api.com` HTTP API — batched (2 calls per move: position before and after), adaptive batch sizes (5 / 3 / 2 / 1 moves per request depending on depth) to stay within Vercel's 10-second function timeout. Analysis can be resumed across requests using Redis progress keys.

### AI Thinking Analysis
Requires engine analysis to be completed first. Sends the player's recorded thought process, engine evaluation, best move and principal variation to Claude. The model and verbosity are user-configurable via Settings. Supports re-analysis and batching across multiple journal entries for a single game.

### Word Document Export (`/api/journal/export`)
1. Load all journal entries and games for the requested date range
2. Group by date, sort chronologically
3. For each entry, resolve the board image (cached base64 → Vercel Blob → chessvision.ai generation)
4. Render using the `docx` library: date headings, game headers with timestamps, board diagrams, entry content, move metadata, AI reviews, post-game reviews, and post-game summary cards with coloured shading
5. Stream the resulting `.docx` buffer as a download

### Board Image Caching
FEN strings are base64-encoded to produce a filesystem-safe blob key (`boards/{encodedFen}-{pov}.png`). A HEAD request checks existence before fetching from chessvision.ai, keeping redundant external calls to zero once an image is cached.

### Backup & Restore
The daily cron snapshots all Redis keys for all users into a single JSON file uploaded to private Vercel Blob storage (`backups/journal-{YYYY-MM-DD}.json`). Restore reads the file, parses each Redis key type (hash vs string), and writes back using the appropriate command. The prune policy runs after every backup.

---

## Data Flow: Writing a Journal Entry

```
User types thought + selects game
         │
         ▼
POST /api/journal
  ├── auth() → resolve userId
  ├── Attach FEN from game, opponentLastMove from PGN (san|from|to)
  └── saveJournalEntry() → Redis HSET chess-diary:{userId}:journal
```

## Data Flow: AI Analysis

```
User clicks "Analyse Thinking"
         │
         ▼
POST /api/games/analyze-thinking
  ├── Verify engine analysis exists (GET analysis from Redis)
  ├── Load journal entries for the game
  ├── Ground the prompt: position facts, SAN engine line, PGN history (lib/position-facts.ts)
  ├── Build prompt (lib/analysis-prompt.ts)
  ├── Call Anthropic Claude API
  ├── Verify [[line: ...]] markers with chess.js; one correction retry if any are illegal (lib/line-verifier.ts)
  └── Save aiReview to journal entry → Redis HSET
```

## Data Flow: Fetching Games

```
User clicks "Fetch Games"
         │
         ▼
POST /api/games/fetch
  ├── getSetting('chesscom_username')
  ├── Promise.all([
  │     fetchPlayerGames(username, month-0),   ← parallel
  │     fetchPlayerGames(username, month-1),
  │     fetchPlayerGames(username, month-2),
  │     fetchActiveGames(username)
  │   ])
  ├── parseChessComGame() → filter to daily only, deduplicate
  ├── getGames() → load existing flags in one Redis call
  └── Promise.all(uniqueGames.map(saveGame))  ← parallel saves
```

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `REDIS_URL` | Yes | Redis connection string |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for AI analysis |
| `CRON_SECRET` | Yes | Bearer token to authenticate Vercel Cron calls |
| `BLOB_IMAGES_READ_WRITE_TOKEN` | Yes | Vercel Blob token for board images and backups |
| `LOG_AI_PROMPTS` | No | Set to `1` to log Claude prompts to `ai-prompt-debug.log` |

Clerk authentication variables (`NEXT_PUBLIC_CLERK_*`) are managed separately by the Clerk dashboard integration.

---

## Scheduled Jobs

Configured in `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/daily", "schedule": "0 2 * * *" }]
}
```

Runs daily at **2:00 AM UTC**. Tasks (in order):
1. **Database backup** — full Redis snapshot → private Vercel Blob
2. **Backup prune** — apply tiered retention policy
3. **Board image cleanup** — delete cached board PNGs older than 90 days

Max function duration: 60 seconds.
