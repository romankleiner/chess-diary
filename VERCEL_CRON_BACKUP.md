# Vercel Cron Automated Backups

Simple, zero-maintenance automated backups using Vercel's built-in cron jobs.

---

## Overview

**What it does:**
- Runs daily at 2 AM UTC (customizable)
- Backs up entire Redis database
- Stores in Vercel Blob Storage
- Automatic 30-day retention
- Email alerts on failure (optional)

**Cost:** $0/month (included in all Vercel plans)

---

## Implementation Steps

### Step 1: Create Backup Endpoint

Create file: `app/api/backup/automated/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { put, list, del } from '@vercel/blob';

// Allow up to 60 seconds for backup
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Security: Verify this is a legitimate cron job
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[BACKUP] Unauthorized access attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[BACKUP] Starting automated backup...');
    
    // Get entire database
    const db = await getDb() as any;
    
    // Create backup with timestamp
    const timestamp = new Date().toISOString();
    const backupData = {
      timestamp,
      version: '1.0',
      data: {
        games: db.games,
        journal_entries: db.journal_entries,
        game_analyses: db.game_analyses || {},
        settings: db.settings,
      },
      stats: {
        gamesCount: Object.keys(db.games || {}).length,
        journalEntriesCount: db.journal_entries?.length || 0,
        analysesCount: Object.keys(db.game_analyses || {}).length,
      }
    };
    
    // Convert to JSON
    const backupJson = JSON.stringify(backupData, null, 2);
    const backupSize = backupJson.length;
    
    // Generate filename: backups/journal-2026-03-11.json
    const dateStr = timestamp.split('T')[0];
    const fileName = `backups/journal-${dateStr}.json`;
    
    console.log('[BACKUP] Uploading to blob storage:', fileName);
    
    // Upload to Vercel Blob Storage
    const blob = await put(fileName, backupJson, {
      access: 'public',
      contentType: 'application/json',
    });
    
    console.log('[BACKUP] Upload complete:', blob.url);
    
    // Clean up old backups (keep last 30 days)
    await cleanupOldBackups();
    
    return NextResponse.json({
      success: true,
      timestamp,
      fileName,
      url: blob.url,
      size: backupSize,
      sizeMB: (backupSize / 1024 / 1024).toFixed(2),
      stats: backupData.stats,
    });
    
  } catch (error) {
    console.error('[BACKUP] Error:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Backup failed',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

async function cleanupOldBackups() {
  try {
    console.log('[BACKUP] Cleaning up old backups...');
    
    // List all backups
    const { blobs } = await list({ prefix: 'backups/' });
    
    // Calculate cutoff date (30 days ago)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    let deletedCount = 0;
    
    for (const blob of blobs) {
      const blobDate = new Date(blob.uploadedAt).getTime();
      
      if (blobDate < thirtyDaysAgo) {
        await del(blob.url);
        console.log('[BACKUP] Deleted old backup:', blob.pathname);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      console.log(`[BACKUP] Cleaned up ${deletedCount} old backup(s)`);
    } else {
      console.log('[BACKUP] No old backups to clean up');
    }
    
  } catch (error) {
    console.error('[BACKUP] Cleanup error:', error);
    // Don't fail backup if cleanup fails
  }
}
```

---

### Step 2: Add Cron Configuration

Create or update: `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/backup/automated",
      "schedule": "0 2 * * *"
    }
  ]
}
```

**Schedule options:**
```
0 2 * * *     - Every day at 2 AM UTC
0 */6 * * *   - Every 6 hours
0 0 * * 0     - Every Sunday at midnight
0 0 1 * *     - First day of each month
0 12 * * 1-5  - Weekdays at noon
```

**Cron format:** `minute hour day month weekday`
- minute: 0-59
- hour: 0-23 (UTC)
- day: 1-31
- month: 1-12
- weekday: 0-7 (0 and 7 are Sunday)

---

### Step 3: Generate Secret Token

Generate a secure random token for authentication:

```bash
# Generate random 32-byte hex string
openssl rand -hex 32

# Example output:
# 8f3a2b9c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a
```

Add to Vercel environment variables:

**Via Vercel Dashboard:**
1. Go to your project on Vercel
2. Settings → Environment Variables
3. Add new variable:
   - Name: `CRON_SECRET`
   - Value: `<paste your generated secret>`
   - Environment: Production, Preview, Development (all)
4. Save

**Via Vercel CLI:**
```bash
vercel env add CRON_SECRET
# Paste your secret when prompted
# Select: Production, Preview, Development
```

---

### Step 4: Deploy

Commit and push your changes:

```bash
# Add files
git add vercel.json app/api/backup/automated/route.ts

# Commit
git commit -m "Add automated daily backups via Vercel cron"

# Push to trigger deployment
git push
```

Vercel will automatically:
- Detect the cron configuration
- Set up the scheduled job
- Start running backups daily at 2 AM UTC

---

## Verification

### Check Cron Jobs in Vercel

1. Go to Vercel Dashboard → Your Project
2. Click **Cron Jobs** tab (should appear after deployment)
3. You'll see: `/api/backup/automated` scheduled for `0 2 * * *`

### Manual Test (Before Waiting for 2 AM)

Test the endpoint manually:

```bash
# Replace with your actual URL and CRON_SECRET
curl -H "Authorization: Bearer YOUR_CRON_SECRET_HERE" \
  https://your-app.vercel.app/api/backup/automated

# Expected response:
{
  "success": true,
  "timestamp": "2026-03-11T14:23:45.678Z",
  "fileName": "backups/journal-2026-03-11.json",
  "url": "https://abc123.public.blob.vercel-storage.com/backups/journal-2026-03-11.json",
  "size": 245678,
  "sizeMB": "0.23",
  "stats": {
    "gamesCount": 12,
    "journalEntriesCount": 45,
    "analysesCount": 8
  }
}
```

### Check Blob Storage

1. Go to Vercel Dashboard → Storage
2. Click on your Blob store
3. Navigate to `backups/` folder
4. You should see: `journal-2026-03-11.json`

### Check Logs (After First Automated Run)

1. Go to Vercel Dashboard → Your Project
2. Click **Logs** tab
3. Filter by `/api/backup/automated`
4. Look for logs around 2 AM UTC:
   ```
   [BACKUP] Starting automated backup...
   [BACKUP] Uploading to blob storage: backups/journal-2026-03-11.json
   [BACKUP] Upload complete: https://...
   [BACKUP] Cleaning up old backups...
   [BACKUP] No old backups to clean up
   ```

---

## Monitoring

### View Backup Status

Create a simple status page to see backup history.

Create: `app/backups/page.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';

export default function BackupsPage() {
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backups/list')
      .then(r => r.json())
      .then(data => {
        setBackups(data.backups || []);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading backups...</div>;

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Backup History</h1>
      
      {backups.length === 0 ? (
        <p>No backups found yet. First backup will run at 2 AM UTC.</p>
      ) : (
        <div className="space-y-2">
          {backups.map((backup) => (
            <div key={backup.url} className="border p-4 rounded">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold">{backup.pathname}</div>
                  <div className="text-sm text-gray-600">
                    {new Date(backup.uploadedAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">
                    Size: {(backup.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <a
                  href={backup.url}
                  download
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                >
                  Download
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Create: `app/api/backups/list/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'backups/' });
    
    // Sort by upload date (newest first)
    const sortedBackups = blobs.sort((a, b) => 
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
    
    return NextResponse.json({
      backups: sortedBackups.map(b => ({
        url: b.url,
        pathname: b.pathname,
        uploadedAt: b.uploadedAt,
        size: b.size,
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list backups' },
      { status: 500 }
    );
  }
}
```

Access at: `https://your-app.vercel.app/backups`

---

## Restoring from Backup

### Manual Restore (Web Interface)

Create: `app/api/restore/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { backupUrl } = await request.json();
    
    if (!backupUrl) {
      return NextResponse.json({ error: 'backupUrl required' }, { status: 400 });
    }
    
    console.log('[RESTORE] Fetching backup from:', backupUrl);
    
    // Fetch backup from blob storage
    const response = await fetch(backupUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch backup: ${response.statusText}`);
    }
    
    const backupData = await response.json();
    
    // Validate backup format
    if (!backupData.data || !backupData.timestamp) {
      throw new Error('Invalid backup format');
    }
    
    console.log('[RESTORE] Backup from:', backupData.timestamp);
    console.log('[RESTORE] Restoring to Redis...');
    
    // Get current database
    const db = await getDb() as any;
    
    // Replace with backup data
    db.games = backupData.data.games;
    db.journal_entries = backupData.data.journal_entries;
    db.game_analyses = backupData.data.game_analyses || {};
    db.settings = backupData.data.settings;
    
    // Save to Redis
    await saveDb(db);
    
    console.log('[RESTORE] Restore complete!');
    
    return NextResponse.json({
      success: true,
      restoredFrom: backupData.timestamp,
      stats: backupData.stats,
    });
    
  } catch (error) {
    console.error('[RESTORE] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Restore failed' },
      { status: 500 }
    );
  }
}
```

### Manual Restore (Command Line)

```bash
# 1. Download backup
curl https://blob.vercel.com/backups/journal-2026-03-11.json > backup.json

# 2. Restore via API
curl -X POST https://your-app.vercel.app/api/restore \
  -H "Content-Type: application/json" \
  -d '{"backupUrl": "https://blob.vercel.com/backups/journal-2026-03-11.json"}'

# Response:
{
  "success": true,
  "restoredFrom": "2026-03-11T02:00:15.123Z",
  "stats": {
    "gamesCount": 12,
    "journalEntriesCount": 45,
    "analysesCount": 8
  }
}
```

---

## Troubleshooting

### Backup Not Running

**Check cron job exists:**
1. Vercel Dashboard → Project → Cron Jobs tab
2. Should show `/api/backup/automated` with schedule

**Check environment variable:**
1. Settings → Environment Variables
2. Verify `CRON_SECRET` exists and is set for Production

**Check logs:**
1. Logs tab → Filter by `/api/backup/automated`
2. Look for errors around 2 AM UTC

### Unauthorized Error

**Symptom:** 401 Unauthorized in logs

**Solution:** 
```bash
# Regenerate and update CRON_SECRET
openssl rand -hex 32
# Update in Vercel dashboard
# Redeploy
```

### Backup Too Large

**Symptom:** Timeout or error saving large backup

**Solution:** Increase `maxDuration`:
```typescript
export const maxDuration = 120; // 2 minutes
```

Or split backups:
```typescript
// Backup games separately from journal
await put('backups/games.json', JSON.stringify(db.games));
await put('backups/journal.json', JSON.stringify(db.journal_entries));
```

### Blob Storage Full

**Symptom:** Upload fails, storage quota exceeded

**Solution:**
- Clean up old backups more aggressively (keep 7 days instead of 30)
- Compress backups before upload
- Upgrade Vercel Blob plan

---

## Customization

### Change Backup Schedule

Edit `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/backup/automated",
      "schedule": "0 */12 * * *"  // Every 12 hours
    }
  ]
}
```

### Add Email Notifications

Install Resend:
```bash
npm install resend
```

Update backup endpoint:
```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// After successful backup:
await resend.emails.send({
  from: 'backups@yourdomain.com',
  to: 'you@gmail.com',
  subject: `✅ Backup successful - ${new Date().toLocaleDateString()}`,
  text: `Backup completed successfully at ${timestamp}\n\nStats:\n${JSON.stringify(backupData.stats, null, 2)}`
});
```

### Compress Backups

```bash
npm install pako
```

```typescript
import pako from 'pako';

// Compress backup
const compressed = pako.gzip(backupJson);

await put(fileName, compressed, {
  access: 'public',
  contentType: 'application/gzip',
});
```

---

## Cost & Limits

**Vercel Cron Jobs (All Plans):**
- ✅ Free
- ✅ Unlimited cron jobs
- ⚠️ Minimum interval: 1 minute
- ⚠️ Max duration: 60 seconds (can increase to 300s on Pro)

**Vercel Blob Storage:**
- **Free Tier:**
  - 500 MB storage
  - 500 GB bandwidth/month
  - 100k requests/month
- **Pro Tier ($20/month):**
  - Unlimited storage
  - 1 TB bandwidth
  - Unlimited requests

**Estimated Usage:**
- Backup size: ~1 MB (typical)
- Daily backups × 30 days: ~30 MB
- Well within free tier! ✅

---

## Summary

### Files Created
- `app/api/backup/automated/route.ts` - Backup endpoint
- `vercel.json` - Cron configuration
- `app/api/backups/list/route.ts` - List backups (optional)
- `app/api/restore/route.ts` - Restore endpoint (optional)
- `app/backups/page.tsx` - Backup UI (optional)

### Environment Variables
- `CRON_SECRET` - Authentication token for cron jobs

### What You Get
- ✅ Daily automated backups at 2 AM UTC
- ✅ 30-day retention (automatic cleanup)
- ✅ Stored in Vercel Blob (CDN-backed)
- ✅ Easy restore process
- ✅ Zero maintenance
- ✅ $0/month cost

### Next Steps
1. Create backup endpoint
2. Add `vercel.json` cron config
3. Set `CRON_SECRET` in Vercel
4. Deploy and verify
5. Check logs after first run at 2 AM UTC
6. (Optional) Add backup status page
7. (Optional) Test restore process

**Your journal data is now automatically backed up every day!** 🎉
