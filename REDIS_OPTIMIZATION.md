# Redis optimization plan

Status tracker for optimizing Redis usage in Chess Diary.

## Summary

The app currently treats Redis as a flat file store — each of 5 keys per user holds a single JSON string containing **all** data of that type. Every read and write deserializes/serializes the entire collection, even when only one item is needed.

---

## Issues & tasks

### 1. Write amplification — `saveDb()` rewrites everything

**Problem:** Almost every mutation follows the pattern `getDb()` → modify one item → `saveDb(db)`. `saveDb` re-serializes and writes all 5 keys, even if only one changed. Toggling a single game's turn writes games, journal, analyses, settings, and progress.

**Fix:** The codebase already has `saveJournal()`, `saveGames()`, `saveAnalyses()`, `saveSettings()`, and `saveProgress()` helpers in `db-redis.ts` — but most routes ignore them and call `saveDb(db)`. Replace `saveDb()` calls with the appropriate targeted helper.

**Affected routes:**
- `api/games/[id]/toggle-turn/route.ts` — only changes games → use `saveGames()`
- `api/games/fetch/route.ts` — only changes games → use `saveGames()`
- `api/games/start/route.ts` — changes games + journal → use `saveGames()` + `saveJournal()`
- `api/journal/route.ts` (POST, DELETE) — only changes journal → use `saveJournal()`
- `api/journal/[id]/route.ts` (PUT, DELETE) — only changes journal → use `saveJournal()`
- `api/journal/post-game-summary/route.ts` — only changes journal → use `saveJournal()`
- `api/settings/route.ts` — only changes settings → use `saveSettings()`
- `api/games/analyze/route.ts` — changes analyses + games + progress → use targeted helpers
- `api/backup/restore/route.ts` — merges everything, `saveDb()` acceptable here

**Effort:** Low — mechanical find-and-replace.
**Status:** [ ] Not started

---

### 2. Read amplification — `getDb()` loads everything

**Problem:** Every API route calls `getDb()`, which issues 5 parallel `GET` commands and parses all 5 JSON blobs. `GET /api/games/[id]/analysis` only needs one game's analysis but deserializes every analysis, every journal entry, every game, etc.

**Fix:** Add partial-read helpers to `db-redis.ts`:
```typescript
export async function getGames(userId?: string): Promise<Record<string, any>>
export async function getJournal(userId?: string): Promise<any[]>
export async function getAnalyses(userId?: string): Promise<Record<string, any>>
export async function getSettings(userId?: string): Promise<Record<string, string>>
export async function getProgress(userId?: string): Promise<Record<string, any>>
```

Then update each route to only read what it needs.

**Affected routes:**
- `api/games/route.ts` — needs games + analyses only
- `api/games/[id]/analysis/route.ts` — needs analyses only
- `api/games/[id]/toggle-turn/route.ts` — needs games only
- `api/journal/route.ts` (GET) — needs journal only
- `api/settings/route.ts` (GET) — needs settings only
- `api/backup/route.ts` — needs everything, `getDb()` acceptable
- `api/debug/redis-size/route.ts` — needs everything, `getDb()` acceptable

**Effort:** Low-medium — add helpers, then update route imports.
**Status:** [ ] Not started

---

### 3. Analysis progress hammers Redis

**Problem:** `setProgress()` in the analyze route does a full `getDb()` + `saveDb()` on **every single move** during analysis. For a 40-move game, that's 40+ full read-modify-write cycles for ephemeral progress data.

**Fix (quick):** Replace with a direct `SET` using the dedicated progress key and add a TTL:
```typescript
async function setProgress(gameId: string, current: number, total: number) {
  const uid = await getUserId();
  const client = getRedisClient();
  const key = `chess-diary:${uid}:progress`;
  const data = await client.get(key);
  const progress = data ? JSON.parse(data) : {};
  progress[gameId] = { current, total, timestamp: Date.now() };
  await client.setex(key, 600, JSON.stringify(progress)); // 10min TTL
}
```

**Fix (better):** Use a per-game progress key with TTL:
```typescript
await client.setex(`chess-diary:${uid}:progress:${gameId}`, 600, JSON.stringify({ current, total }));
```

**Effort:** Low.
**Status:** [ ] Not started

---

### 4. Race conditions — no atomicity

**Problem:** Multiple concurrent requests can each call `getDb()`, get a snapshot, modify it independently, then call `saveDb()` — the last writer wins and silently overwrites the other's changes. Two journal entries created simultaneously can lose one.

**Fix (short-term):** For journal entries (append-only list), use Redis `RPUSH` or `LPUSH` instead of read-modify-write. For game updates, use `WATCH`/`MULTI` transactions or Lua scripts.

**Fix (long-term):** Restructure data model (see item 6) so individual records are separate keys — then updates are naturally atomic.

**Effort:** Medium.
**Status:** [ ] Not started

---

### 5. No TTL or expiration on any key

**Problem:** Nothing ever expires. Stale analysis progress entries are cleaned up via a manual 10-minute timestamp check in application code. Old data accumulates without bound.

**Fix:**
- Add `SETEX` (or `EX` option) for analysis progress keys — 600 seconds matches the existing staleness check.
- Consider TTLs for analysis data if storage becomes a concern.
- Remove the manual timestamp-based cleanup logic once TTLs are in place.

**Effort:** Low.
**Status:** [ ] Not started

---

### 6. Long-term — model data properly in Redis

**Problem:** Each key is a giant JSON blob. Fetching one game requires deserializing all games. Filtering journal entries by date happens in JavaScript, not Redis.

**Fix:** Use native Redis data structures:

| Current | Proposed | Benefit |
|---------|----------|---------|
| `chess-diary:{uid}:games` → JSON blob of all games | `HSET chess-diary:{uid}:games {gameId} {gameJSON}` | `HGET` for one game, `HGETALL` for all, `HSET` to update one |
| `chess-diary:{uid}:journal` → JSON array | `ZADD chess-diary:{uid}:journal {timestamp} {entryJSON}` | `ZRANGEBYSCORE` for date-range filtering server-side |
| `chess-diary:{uid}:analyses` → JSON blob | `HSET chess-diary:{uid}:analyses {gameId} {analysisJSON}` | `HGET` for one analysis |
| `chess-diary:{uid}:settings` → JSON object | `HSET chess-diary:{uid}:settings {key} {value}` | `HGET`/`HSET` for individual settings |

This eliminates serialization overhead and makes all operations O(1) per record instead of O(total data).

**Effort:** High — requires updating every route and migrating existing data.
**Status:** [ ] Not started

---

### 7. Use Redis pipelining

**Problem:** `getDb()` uses `Promise.all` for parallelism, which sends 5 independent commands over the connection. Each command is a separate network round-trip.

**Fix:** Use `client.pipeline()` to batch commands into a single round-trip:
```typescript
const pipeline = client.pipeline();
pipeline.get(`chess-diary:${uid}:games`);
pipeline.get(`chess-diary:${uid}:journal`);
// ...
const results = await pipeline.exec();
```

This matters most in environments with network latency between the app and Redis (e.g., Vercel serverless → Upstash).

**Effort:** Low.
**Status:** [ ] Not started

---

## Suggested order

1. **Items 1 + 2** (use existing helpers, add partial-read helpers) — immediate win, low risk
2. **Item 3** (fix progress writes) — quick fix, high impact during analysis
3. **Item 7** (pipelining) — small change, measurable latency improvement
4. **Item 5** (TTLs) — housekeeping, prevents data rot
5. **Item 4** (race conditions) — important for correctness, medium effort
6. **Item 6** (data model) — biggest payoff, but requires migration strategy
