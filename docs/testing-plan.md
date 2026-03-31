# Chess Diary — Test Suite Plan

## Framework: Vitest

**Why not Jest:** The project uses `"module": "esnext"` + `"moduleResolution": "bundler"` in `tsconfig.json`. Jest requires Babel or `ts-jest` to transform ESM and fights with Next.js's module resolution. Vitest is natively ESM, understands `@/*` path aliases via `vite-tsconfig-paths`, and has an identical `vi.mock()` / `vi.fn()` API.

**Packages to add (dev only):**
```
vitest  @vitest/coverage-v8  vite-tsconfig-paths
```

---

## The One Big Complication: Clerk + Redis

`lib/db.ts` calls `auth()` from Clerk inside *every* exported function, and talks to Redis via `ioredis` — not a local JSON file. Both must be mocked. The plan handles this with two shared helpers in `__tests__/helpers/`:

- **`mock-clerk.ts`** — applied globally via `setupFiles`, stubs `auth()` to return `{ userId: 'test-user-123' }` so every test acts as an authenticated user
- **`mock-redis.ts`** — a `Map`-backed in-memory client implementing `hget/hset/hdel/hgetall/get/set/setex/del/pipeline`, allowing DB-layer tests without a running Redis server

---

## Testing Strategy by Layer

| Layer | Strategy |
|---|---|
| Pure functions | Direct import, zero mocks |
| DB layer | `vi.mock('ioredis')` with in-memory Redis mock |
| API route handlers | `vi.mock('@/lib/db')` (mock the whole DB module), call `GET`/`POST`/etc. directly with a real `NextRequest` |
| Anthropic / Chess.com calls | `vi.stubGlobal('fetch', vi.fn())` returning controlled responses |

Route handlers are tested by **direct import** — e.g. `import { POST } from '@/app/api/games/[id]/blog-post/route'` then `await POST(req)`. No running server needed.

---

## Folder Structure

```
__tests__/
  helpers/
    mock-clerk.ts          # Global Clerk auth stub (vi.mock)
    mock-redis.ts          # In-memory ioredis-compatible store
    fixtures.ts            # Typed test data (Game, JournalEntry, etc.)
  unit/
    chesscom.test.ts       # parseChessComGame, determineResult
    analysis.test.ts       # calculateAccuracy, getMoveQuality
    analysis-prompt.test.ts # buildAnalysisPrompt (all verbosity branches)
    statistics.test.ts     # computeStatistics
    journal-filter.test.ts # Date filter logic, getLocalTimestamp
  db/
    games.test.ts          # getGame, saveGame, deleteGame, getGames
    journal.test.ts        # getJournalEntry, saveJournalEntry, getJournal
    settings.test.ts       # getSetting, saveSetting (null vs 'null' edge case)
    progress.test.ts       # setGameProgress, getGameProgress, clearGameProgress
  routes/
    api-games.test.ts           # GET /api/games — analysis flag merging, sort
    api-games-fetch.test.ts     # POST /api/games/fetch — dedup, preserve flags
    api-games-start.test.ts     # POST /api/games/start — missing params, entry creation
    api-games-toggle.test.ts    # POST /api/games/[id]/toggle-turn
    api-journal.test.ts         # GET/POST/DELETE /api/journal
    api-journal-id.test.ts      # PUT/DELETE /api/journal/[id]
    api-journal-summary.test.ts # GET/POST /api/journal/post-game-summary
    api-settings.test.ts        # GET/PUT /api/settings
    api-blog-post.test.ts       # POST /api/games/[id]/blog-post
    api-analyze-thinking.test.ts # POST /api/games/analyze-thinking
vitest.config.ts
```

---

## Prioritised Test Cases

### Tier 1 — Pure functions (write first, zero infrastructure)

These run in milliseconds and protect the most complex logic.

- [x] `parseChessComGame` — archived vs. active format, non-daily returns null, ID extraction from URL, opponent selection
- [x] `determineResult` — win/loss/draw from each player's perspective
- [x] `calculateAccuracy` — empty array → 100, zero CP loss → ~100, large CP loss → approaches 0, always clamped 0–100
- [x] `getMoveQuality` — boundary values at exactly 25/50/100/200 cp
- [x] `computeStatistics` — user is white vs. black; correct blunder/mistake/inaccuracy counts; missing `moves` → null
- [x] `buildAnalysisPrompt` — FEN included/omitted; PV as array vs. string; each verbosity mode produces different instructions
- [x] Date filter logic — boundary dates included, out-of-range excluded, no params → all entries

### Tier 2 — DB layer with in-memory Redis mock

- [x] `getGame` / `saveGame` / `deleteGame` — full round-trip, delete → null
- [x] `saveJournalEntry` / `getJournal` — empty hash returns `[]` not null/undefined
- [x] `getSetting` with missing key returns `null` (not the string `"null"`)
- [x] `setGameProgress` / `clearGameProgress` — TTL is set; cleared key returns null
- [x] `getDb` — correct `DatabaseData` shape assembled; error in one sub-call returns `getEmptyDb()` shape

### Tier 3 — Route handlers with mocked DB module

- [x] `GET /api/games` — `analysisCompleted` merged from analyses, not game objects; sorted by date desc
- [x] `GET /api/journal` — date params filter correctly
- [x] `POST /api/journal` — `id` assigned as number, `timestamp` set, entry returned
- [x] `PUT /api/journal/[id]` — 404 on missing entry; only allowed fields merged
- [x] `POST /api/games/start` — 400 on missing `gameUrl`; 400 when username not set
- [x] `POST /api/games/fetch` — deduplicates by ID; preserves existing `analysisCompleted`
- [x] `POST /api/journal/post-game-summary` — 409 on duplicate; `computeStatistics` called with lowercased username
- [x] `GET/PUT /api/settings` — empty object returned when nothing set; each key saved

### Tier 4 — Routes with mocked `fetch` (Anthropic / Chess.com)

- [x] `POST /api/games/[id]/blog-post` — 404 on missing game; prompt contains PGN and analysis stats; FEN entries produce `[DIAGRAM:...]` markers; response returns `{ post, prompt }`; Anthropic failure → 500
- [x] `POST /api/games/analyze-thinking` — skips empty-content entries; saves `aiReview` on success; `maxTokens` varies by verbosity; `needsEngineAnalysis: true` when no engine data

### Tier 5 — Write last (complex, diminishing returns)

- [x] `POST /api/games/analyze` — `calculateAccuracy` + `getMoveQuality` integration through a full batch result; `IS_VERCEL` branching (requires `vi.resetModules()` + dynamic import)
- [x] `GET /api/journal/export?format=docx` — duplicate-entry dedup; PNG/JPEG magic-byte image detection; docx library invoked

---

## Notable Gotchas

- **`@se-oss/stockfish`** may be a WASM/native module — add to `server.deps.external` in `vitest.config.ts` and always mock it; never load the real engine in tests
- **`Date.now()` as ID** — use `vi.spyOn(Date, 'now').mockReturnValue(12345)` when asserting exact IDs, or just assert `typeof id === 'number'`
- **`IS_VERCEL` module-level constant** — testing both analyze branches requires `vi.resetModules()` + dynamic import after setting `process.env.VERCEL`
- **Clerk middleware is not invoked** when calling handlers directly — this is correct; auth is controlled entirely by the `auth()` mock

---

## Implementation Notes

### `vitest.config.ts` sketch

```ts
// test.environment: 'node'         (not jsdom — all tests are server-side)
// resolve.alias: { '@': '.' }      (mirrors tsconfig paths)
// test.setupFiles: ['__tests__/helpers/mock-clerk.ts']
// coverage.provider: 'v8'
// coverage.include: ['lib/**', 'app/api/**']
// server.deps.external: ['@se-oss/stockfish']
```

### Clerk mock (`__tests__/helpers/mock-clerk.ts`)

```ts
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-user-123' }),
  clerkMiddleware: vi.fn(),
  createRouteMatcher: vi.fn(() => () => false),
}))
```

### DB module mock for route tests

Rather than wiring Redis through to route tests, mock the entire DB module:

```ts
vi.mock('@/lib/db', () => ({
  getGames: vi.fn(),
  saveGame: vi.fn(),
  getGame: vi.fn(),
  // ... all exported functions as vi.fn()
}))
// Then per test:
vi.mocked(getGames).mockResolvedValue([...])
```

### `package.json` scripts to add

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```
