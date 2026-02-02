# CLAUDE.md

## Project Overview

Chess Diary is a Next.js web app for chess players to journal thoughts during games and track games from Chess.com. Users write daily reflections, attach thoughts to specific games/moves, and export journal entries to Word documents.

## Tech Stack

- **Framework:** Next.js 15 (App Router) with React 18, TypeScript 5.6
- **Styling:** Tailwind CSS 3.4 with dark mode via CSS custom properties
- **Chess Logic:** chess.js 1.0
- **Document Export:** docx 9.5.1 (Word generation)
- **Storage:** Local JSON file (`chess-diary-data.json`, gitignored), cached in memory at runtime
- **No external database** - all data persisted to a single JSON file via `lib/db.ts`

## Commands

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint (eslint-config-next)
```

No test framework is configured. No Prettier or pre-commit hooks.

## Project Structure

```
app/                        # Next.js App Router pages and API routes
  api/
    games/route.ts          # GET all games
    games/fetch/route.ts    # GET games from Chess.com API
    games/start/route.ts    # POST start tracking a game
    games/[id]/toggle-turn/ # POST toggle game turn
    journal/route.ts        # GET/POST journal entries
    journal/[id]/route.ts   # DELETE/PUT journal entries
    journal/export/route.ts # GET export as DOCX
    settings/route.ts       # GET/POST settings
  games/page.tsx            # Games list page
  games/[id]/page.tsx       # Game detail page
  journal/page.tsx          # Journal page (main UI)
  settings/page.tsx         # Settings page
  page.tsx                  # Home page
  layout.tsx                # Root layout with navigation
  globals.css               # Global styles + dark mode variables
lib/
  db.ts                     # JSON file-based database with in-memory cache
  chesscom.ts               # Chess.com public API client
  stockfish.ts              # Stockfish integration (placeholder, not implemented)
  export-journal.js         # Word document generation (runs as subprocess)
types/
  index.ts                  # TypeScript type definitions (Game, JournalEntry, MoveAnalysis, Settings)
```

## Key Architecture Patterns

- **API routes** handle all data operations; pages fetch from these endpoints client-side
- **Database** (`lib/db.ts`): reads/writes `chess-diary-data.json` with in-memory caching. Structure: `{ games: {}, journal_entries: [], move_analysis: [], settings: {} }`
- **Journal entries** have two types: `"general"` (daily thoughts) and `"game"` (tied to a specific game, with optional FEN, move number, move notation)
- **Images** stored as base64 data URLs within journal entries (pasted from clipboard)
- **Word export** spawns a Node.js subprocess (`lib/export-journal.js`) that receives data via stdin and returns base64-encoded docx via stdout
- **Chess.com integration** handles two response formats: archived games (objects) and active games (URL strings). Only fetches daily time control games.
- **Board diagrams** rendered via external chessvision.ai FEN-to-image service
- **Server actions** body size limit set to 2MB in `next.config.js` (for image uploads)

## Environment Variables

Chess.com API is public and requires no API key. The only user-configured setting is `chesscom_username`, stored in the JSON database via the settings page.

## TypeScript

Strict mode enabled. Path alias `@/*` maps to project root.
