# Dev Environment Setup — Windows (PowerShell)

This guide walks through setting up a local development environment for Chess Diary on Windows using PowerShell. After completing these steps you will have the app running at `http://localhost:3000` with full auth, AI analysis, and database connectivity.

---

## Prerequisites

### 1. Node.js

Install Node.js 20 or later (the project currently runs on v24). The recommended way on Windows is via [nvm-windows](https://github.com/coreybutler/nvm-windows):

```powershell
# After installing nvm-windows, in a new PowerShell window:
nvm install lts
nvm use lts
node --version   # should print v20.x or higher
npm --version
```

Alternatively, download the installer directly from https://nodejs.org.

### 2. Git

Install Git for Windows from https://git-scm.com/download/win. During setup, choose **"Git from the command line and also from 3rd-party software"** so PowerShell can use it.

### 3. Vercel CLI (optional but recommended)

The easiest way to pull environment variables from the Vercel project is with the Vercel CLI:

```powershell
npm install -g vercel
vercel --version
```

---

## Clone the Repository

```powershell
git clone https://github.com/romankleiner/chess-diary.git
cd chess-diary
```

---

## Install Dependencies

```powershell
npm install
```

---

## Environment Variables

The app requires several secrets to run. There are two ways to provide them.

### Option A — Pull from Vercel (recommended)

If you have access to the Vercel project, this pulls all variables automatically and writes `.env.local`:

```powershell
vercel link        # link this directory to the Vercel project (one-time)
vercel env pull    # writes .env.development.local
```

### Option B — Create `.env.local` manually

Create a file called `.env.local` in the project root with the following variables:

```
# Redis (Upstash or any Redis-compatible URL)
REDIS_URL=rediss://...

# Anthropic Claude API
ANTHROPIC_API_KEY=sk-ant-...

# Clerk Authentication
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/journal
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/journal

# Vercel Blob (two separate stores)
BLOB_READ_WRITE_TOKEN=vercel_blob_...
BLOB_IMAGES_READ_WRITE_TOKEN=vercel_blob_...

# Vercel Cron authentication (any random string for local testing)
CRON_SECRET=any-local-secret

# Optional: log AI prompts to ai-prompt-debug.log
# LOG_AI_PROMPTS=1
```

> **Note:** `.env*.local` files are gitignored and will never be committed.

### Where to get the values

| Variable | Source |
|---|---|
| `REDIS_URL` | [Upstash](https://upstash.com) console → Database → Connect → ioredis |
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com) → API Keys |
| `CLERK_*` | [Clerk Dashboard](https://dashboard.clerk.com) → API Keys |
| `BLOB_*_TOKEN` | [Vercel Dashboard](https://vercel.com) → Storage → Blob stores |

---

## Start the Dev Server

```powershell
npm run dev
```

Open http://localhost:3000 in your browser. Sign in with Clerk, then go to **Settings** and enter your Chess.com username to start fetching games.

---

## Other Useful Commands

```powershell
npm run build          # production build (also validates TypeScript)
npm run lint           # ESLint
npm test               # run test suite (scripts/test.mjs)
npm run test:watch     # Vitest in watch mode
npm run test:coverage  # Vitest with coverage report
```

---

## Common Issues on Windows

### `sharp` fails to install

`sharp` (used for image processing) compiles a native binary. If `npm install` fails with a `sharp` error, run:

```powershell
npm install --ignore-scripts
npm rebuild sharp
```

If that still fails, install the Visual Studio Build Tools:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
```

Then retry `npm install`.

### PowerShell execution policy

If scripts are blocked, enable them for the current user:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Port 3000 already in use

Find and kill the process using port 3000:

```powershell
$proc = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
if ($proc) { Stop-Process -Id $proc -Force; Write-Host "Killed PID $proc" } else { Write-Host "Port 3000 is free" }
```

Or start the dev server on a different port:

```powershell
$env:PORT = 3001; npm run dev
```

### `CRON_SECRET` for local cron testing

The daily cron endpoint (`/api/cron/daily`) requires a Bearer token. To trigger it manually during development:

```powershell
$secret = "any-local-secret"   # must match CRON_SECRET in .env.local
Invoke-WebRequest -Uri "http://localhost:3000/api/cron/daily" `
  -Headers @{ Authorization = "Bearer $secret" }
```

---

## Project Layout Quick Reference

```
chess-diary/
  app/                  # Next.js App Router pages and API routes
    api/                # Backend API routes (all data operations)
    games/              # Games list and detail pages
    journal/            # Main journal UI
    settings/           # User settings
    backups/            # Backup management (admin only)
  components/           # Shared React components
  lib/                  # Server-side modules (db, analysis, export, …)
  data/                 # Static assets (opening-book.bin)
  docs/                 # Project documentation
  public/               # Static files served by Next.js
  types/                # TypeScript type definitions
  ARCHITECTURE.md       # Full system design documentation
```

See [ARCHITECTURE.md](../ARCHITECTURE.md) for a complete description of every module, API route, and architectural pattern.
