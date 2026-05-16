# Chess Diary — Architecture

## Overview

Chess Diary is a **Next.js 15 (App Router)** web application for daily-chess players. It lets users record their thinking during correspondence games on Chess.com, attach notes to specific positions, get AI-powered analysis of their thought process, and export their journal to a Word document.

All data is private per authenticated user. There is no shared or public data.

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

Pages are React Client Components (`'use client'`) that call API routes via `fetch()`. No server-side props or server actions are used — the pattern is a classic SPA backed by JSON API routes.

---

## Frontend Pages

| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Home / dashboard |
| `/journal` | `app/journal/page.tsx` | Main journal editor — write entries, select games, view history |
| `/games` | `app/games/page.tsx` | Game list with analysis status and post-game summary forms |
| `/games/[id]` | `app/games/[id]/page.tsx` | Individual game detail and journal entries for that game |
| `/games/[id]/analysis` | `app/games/[id]/analysis/page.tsx` | Move-by-move engine analysis viewer |
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
| POST | `/api/games/[id]/blog-post` | Generate a markdown blog post from analysis + journal |

### Journal

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/journal` | List entries (filtered by date) / create entry |
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
- `calculateAccuracy(winPercentageLoss)` — chess.com win-percentage accuracy formula
- `getMoveQuality(centipawnLoss, isBookMove)` — classifies moves as book / excellent / good / inaccuracy / mistake / blunder
- `normalizeCpLoss(cp)` — handles mate-score ceiling artifacts

### `lib/analysis-prompt.ts` — Claude Prompt Builder
Constructs the prompt sent to Claude for AI analysis of player thinking. Incorporates: position FEN, engine evaluation before/after, best move, principal variation, the player's recorded thought process, and game context. Adjusts wording when the move is in the opening book.

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
  ├── Build prompt (lib/analysis-prompt.ts)
  ├── Call Anthropic Claude API (streaming)
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
