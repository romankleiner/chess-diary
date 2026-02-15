# Debug Endpoints Guide

This app has several debug endpoints for maintenance tasks. They are protected and only work in development mode.

## Available Endpoints

### 1. Delete All Analyses
**Path:** `/api/debug/delete-analyses`  
**Method:** POST  
**Purpose:** Wipe all game analysis data and reset flags

**When to use:**
- Cleaning up before re-analyzing all games
- Fixing corrupted analysis data
- Starting fresh with new analysis engine/depth

**How to use:**
1. Open your app in browser (while logged in)
2. Press F12 to open Developer Console
3. Paste and run:
```javascript
fetch('/api/debug/delete-analyses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}).then(r => r.json()).then(console.log)
```

**Response:**
```json
{
  "success": true,
  "deletedCount": 9,
  "flagsCleared": 9,
  "message": "Deleted 9 analysis/analyses. You can now re-analyze your games."
}
```

---

### 2. Check Database
**Path:** `/api/debug/check-db`  
**Method:** GET  
**Purpose:** Inspect database contents and counts

**How to use:**
Visit in browser: `http://localhost:3000/api/debug/check-db`

**Shows:**
- Total games count
- Total journal entries
- Number of analyses
- Which games are marked as analyzed
- Sample game data

---

### 3. Repair Analysis Flags
**Path:** `/api/debug/repair-flags`  
**Method:** POST  
**Purpose:** Fix analysisCompleted flags to match actual data

**How to use:**
```javascript
fetch('/api/debug/repair-flags', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}).then(r => r.json()).then(console.log)
```

**When to use:**
- Flags are out of sync with actual analysis data
- "View Analysis" buttons missing despite data existing

---

### 4. Check Specific Game Analysis
**Path:** `/api/debug/game-analysis/[gameId]`  
**Method:** GET  
**Purpose:** Inspect analysis data for a specific game

**How to use:**
Visit: `http://localhost:3000/api/debug/game-analysis/899870285`

**Shows:**
- Whether game exists
- Whether analysis exists
- Analysis depth and engine used
- Accuracy scores
- Move count
- Full raw analysis data

---

## Security

All debug endpoints have these protections:

1. **Development-only:** Automatically disabled on Vercel production
   ```typescript
   if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV) {
     return 403 Forbidden
   }
   ```

2. **Authentication required:** Must be logged in (uses Clerk auth)

3. **Local only:** curl won't work, must use browser with auth cookies

## Common Workflows

### Clean Slate Re-analysis
1. Delete all analyses: `/api/debug/delete-analyses` (POST)
2. Verify clean: `/api/debug/check-db` (GET)
3. Re-analyze games from Games page
4. New analyses will have proper depth/engine tracking

### Fix Broken Flags
1. Check current state: `/api/debug/check-db` (GET)
2. Repair flags: `/api/debug/repair-flags` (POST)
3. Verify fixed: `/api/debug/check-db` (GET)

### Debug Single Game
1. Find game ID from Games page
2. Check analysis: `/api/debug/game-analysis/[gameId]` (GET)
3. Inspect depth, engine, move count, accuracy

## Notes

- Always run in browser console (F12) for POST requests
- GET requests can be visited directly in browser
- Endpoints won't work on production Vercel deployment
- Safe to leave in codebase - they're protected
