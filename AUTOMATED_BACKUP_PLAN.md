# Automated Journal Backup System

## The Problem

**Redis Data Loss Scenarios:**
- Vercel Redis instance deleted accidentally
- Redis quota exceeded → data evicted
- Deployment issues → data corruption
- Manual deletion mistakes

**Current Risk:** 
- No automated backups
- All journal data only in Redis
- Manual export required

## Solution: Automated Backups

Multiple backup strategies to ensure data safety.

---

## Strategy 1: Vercel Cron Jobs (Recommended)

### How It Works

Vercel's cron jobs run serverless functions on a schedule.

**Setup:**

1. **Create backup endpoint:**

```typescript
// app/api/backup/automated/route.ts
import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { put } from '@vercel/blob';

export const maxDuration = 60; // Allow up to 60 seconds for backup

export async function GET(request: NextRequest) {
  // Verify this is a cron job (security)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
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
    
    // Upload to blob storage
    const backupJson = JSON.stringify(backupData, null, 2);
    const fileName = `backups/journal-${timestamp.split('T')[0]}.json`;
    
    const blob = await put(fileName, backupJson, {
      access: 'public',
      contentType: 'application/json',
    });
    
    console.log('[BACKUP] Created:', blob.url);
    
    return NextResponse.json({
      success: true,
      timestamp,
      fileName,
      url: blob.url,
      size: backupJson.length,
      stats: backupData.stats,
    });
    
  } catch (error) {
    console.error('[BACKUP] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Backup failed' },
      { status: 500 }
    );
  }
}
```

2. **Add cron configuration:**

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/backup/automated",
      "schedule": "0 2 * * *"
    }
  ]
}
```

Schedule formats:
- `0 2 * * *` - Every day at 2 AM UTC
- `0 */6 * * *` - Every 6 hours
- `0 0 * * 0` - Every Sunday at midnight
- `0 0 1 * *` - First day of every month

3. **Add environment variable:**

```bash
# Generate a random secret
CRON_SECRET=$(openssl rand -hex 32)

# Add to Vercel
vercel env add CRON_SECRET
```

4. **Deploy:**

```bash
git add vercel.json app/api/backup/automated/route.ts
git commit -m "Add automated backups"
git push
```

**Vercel will automatically:**
- Run backup daily at 2 AM UTC
- Upload to blob storage
- Retry on failure
- Send error notifications

### Pros/Cons

✅ **Pros:**
- Zero maintenance
- Runs automatically
- Built into Vercel
- Free (included in all plans)
- Error notifications

❌ **Cons:**
- Limited to 1 backup/day on free tier
- Requires Vercel Blob storage
- Can't backup more frequently than 1 minute

---

## Strategy 2: GitHub Actions (Most Flexible)

### How It Works

GitHub Actions can run scheduled workflows that call your API.

**Setup:**

1. **Create backup workflow:**

```yaml
# .github/workflows/backup.yml
name: Automated Journal Backup

on:
  schedule:
    # Run every 6 hours
    - cron: '0 */6 * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  backup:
    runs-on: ubuntu-latest
    
    steps:
      - name: Trigger backup
        run: |
          curl -X POST "${{ secrets.BACKUP_URL }}" \
            -H "Authorization: Bearer ${{ secrets.BACKUP_TOKEN }}" \
            -o backup.json
      
      - name: Upload to repository
        uses: actions/upload-artifact@v3
        with:
          name: journal-backup-${{ github.run_number }}
          path: backup.json
          retention-days: 90
      
      - name: Commit to backup branch (optional)
        run: |
          git config user.name "Backup Bot"
          git config user.email "backup@github.com"
          git checkout -b backups || git checkout backups
          mkdir -p backups
          cp backup.json backups/backup-$(date +%Y-%m-%d-%H%M).json
          git add backups/
          git commit -m "Backup: $(date)" || echo "No changes"
          git push origin backups || echo "Push failed"
```

2. **Add GitHub secrets:**

Go to GitHub → Settings → Secrets → Actions:
- `BACKUP_URL`: `https://your-app.vercel.app/api/backup`
- `BACKUP_TOKEN`: Random secret token

3. **Create protected backup API:**

```typescript
// app/api/backup/route.ts
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  
  if (token !== process.env.BACKUP_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const db = await getDb() as any;
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    data: db
  });
}
```

### Pros/Cons

✅ **Pros:**
- Very flexible scheduling
- Free unlimited backups
- Backup stored in GitHub (version control!)
- Can run multiple times per hour
- Manual trigger available

❌ **Cons:**
- Requires GitHub Actions setup
- Limited to public repos (or paid GitHub)
- 2000 minutes/month on free tier

---

## Strategy 3: Vercel Blob + Retention Policy

### How It Works

Store backups in Vercel Blob with automatic cleanup of old backups.

**Enhanced backup endpoint:**

```typescript
// app/api/backup/automated/route.ts
import { list, del, put } from '@vercel/blob';

export async function GET(request: NextRequest) {
  // ... authentication ...
  
  // Create new backup
  const timestamp = new Date().toISOString();
  const backupData = { /* ... */ };
  const fileName = `backups/journal-${timestamp}.json`;
  
  await put(fileName, JSON.stringify(backupData), {
    access: 'public',
    contentType: 'application/json',
  });
  
  // Clean up old backups (keep last 30 days)
  const { blobs } = await list({ prefix: 'backups/' });
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  
  for (const blob of blobs) {
    const blobDate = new Date(blob.uploadedAt).getTime();
    if (blobDate < thirtyDaysAgo) {
      await del(blob.url);
      console.log('[BACKUP] Deleted old backup:', blob.pathname);
    }
  }
  
  return NextResponse.json({ success: true });
}
```

**Retention strategies:**
- Keep daily backups for 30 days
- Keep weekly backups for 6 months
- Keep monthly backups forever

```typescript
// Smart retention
const backups = await list({ prefix: 'backups/' });
const keep = new Set<string>();

// Keep all backups from last 7 days
const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
backups.blobs.forEach(blob => {
  if (new Date(blob.uploadedAt).getTime() > sevenDaysAgo) {
    keep.add(blob.url);
  }
});

// Keep one backup per week for last 6 months
// Keep one backup per month for everything older

// Delete everything not in keep set
backups.blobs.forEach(async blob => {
  if (!keep.has(blob.url)) {
    await del(blob.url);
  }
});
```

---

## Strategy 4: Email Backups (Simple)

### How It Works

Email yourself a backup weekly using Resend or SendGrid.

```typescript
// app/api/backup/email/route.ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(request: NextRequest) {
  const db = await getDb() as any;
  const backupJson = JSON.stringify(db, null, 2);
  
  await resend.emails.send({
    from: 'backups@yourdomain.com',
    to: 'your-email@gmail.com',
    subject: `Chess Journal Backup - ${new Date().toISOString()}`,
    text: 'See attached backup',
    attachments: [
      {
        filename: `backup-${new Date().toISOString()}.json`,
        content: Buffer.from(backupJson).toString('base64'),
      },
    ],
  });
  
  return NextResponse.json({ success: true });
}
```

**Pros:**
- Simple
- Backup in your inbox
- Easy to restore manually

**Cons:**
- Email size limits
- Not automated without cron
- Manual restore process

---

## Strategy 5: Multi-Destination Backups (Enterprise)

### How It Works

Backup to multiple locations for redundancy.

```typescript
export async function createBackup() {
  const db = await getDb();
  const backupData = JSON.stringify(db);
  const timestamp = new Date().toISOString();
  
  // 1. Vercel Blob
  await put(`backups/blob-${timestamp}.json`, backupData, {
    access: 'public',
  });
  
  // 2. AWS S3
  await s3.putObject({
    Bucket: 'chess-diary-backups',
    Key: `backups/s3-${timestamp}.json`,
    Body: backupData,
  });
  
  // 3. GitHub (via API)
  await octokit.repos.createOrUpdateFileContents({
    owner: 'username',
    repo: 'chess-diary-backups',
    path: `backups/${timestamp}.json`,
    message: `Backup ${timestamp}`,
    content: Buffer.from(backupData).toString('base64'),
  });
  
  return { success: true, locations: 3 };
}
```

---

## Recommended Setup (Best Practice)

**Combine multiple strategies:**

1. **Primary:** Vercel Cron + Blob Storage
   - Daily automated backups at 2 AM
   - 30-day retention
   - Fast, reliable, zero maintenance

2. **Secondary:** GitHub Actions (weekly)
   - Weekly backup to GitHub repo
   - Infinite retention
   - Version control benefits

3. **Emergency:** Manual backup button in Settings
   - User-triggered anytime
   - Downloads JSON to computer

**Implementation:**

```typescript
// vercel.json
{
  "crons": [
    {
      "path": "/api/backup/automated",
      "schedule": "0 2 * * *"  // Daily at 2 AM
    }
  ]
}
```

```yaml
# .github/workflows/backup.yml
on:
  schedule:
    - cron: '0 0 * * 0'  // Weekly on Sunday
```

---

## Restore Process

### From Blob Storage

```typescript
// app/api/restore/route.ts
import { list } from '@vercel/blob';

export async function GET() {
  // List available backups
  const { blobs } = await list({ prefix: 'backups/' });
  return NextResponse.json({
    backups: blobs.map(b => ({
      url: b.url,
      date: b.uploadedAt,
      size: b.size,
    }))
  });
}

export async function POST(request: NextRequest) {
  const { backupUrl } = await request.json();
  
  // Fetch backup
  const response = await fetch(backupUrl);
  const backupData = await response.json();
  
  // Restore to Redis
  const db = await getDb() as any;
  Object.assign(db, backupData.data);
  await saveDb(db);
  
  return NextResponse.json({ success: true });
}
```

### Manual Restore

```bash
# Download backup
curl https://blob.vercel.com/backups/journal-2026-03-11.json > backup.json

# Restore via API
curl -X POST https://your-app.vercel.app/api/restore \
  -H "Content-Type: application/json" \
  -d @backup.json
```

---

## Monitoring & Alerts

### Verify Backups Work

```typescript
// app/api/backup/verify/route.ts
export async function GET() {
  const { blobs } = await list({ prefix: 'backups/' });
  
  // Check latest backup
  const latest = blobs.sort((a, b) => 
    new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  )[0];
  
  if (!latest) {
    return NextResponse.json({ 
      ok: false, 
      error: 'No backups found' 
    });
  }
  
  const age = Date.now() - new Date(latest.uploadedAt).getTime();
  const hoursOld = age / (1000 * 60 * 60);
  
  if (hoursOld > 48) {
    return NextResponse.json({ 
      ok: false, 
      error: `Latest backup is ${hoursOld.toFixed(0)} hours old` 
    });
  }
  
  return NextResponse.json({ 
    ok: true, 
    latestBackup: latest.uploadedAt,
    backupCount: blobs.length 
  });
}
```

### UptimeRobot Monitor

Set up UptimeRobot to check backup health:
- Monitor: `https://your-app.vercel.app/api/backup/verify`
- Interval: Every 24 hours
- Alert if backup >48 hours old

---

## Cost Estimate

**Vercel Blob (Free Tier):**
- Storage: 500MB → Can store ~500 daily backups
- Bandwidth: 500GB/month → Plenty for backups
- **Cost: $0/month**

**GitHub Actions (Free Tier):**
- 2000 minutes/month
- Each backup takes ~1 minute
- **Cost: $0/month** (for reasonable usage)

**Total:** **$0/month** for automated backups! 🎉

---

## Quick Start Guide

1. **Add to vercel.json:**
```json
{
  "crons": [{
    "path": "/api/backup/automated",
    "schedule": "0 2 * * *"
  }]
}
```

2. **Create endpoint:** `app/api/backup/automated/route.ts`

3. **Generate secret:**
```bash
CRON_SECRET=$(openssl rand -hex 32)
vercel env add CRON_SECRET
```

4. **Deploy:**
```bash
git add .
git commit -m "Add automated backups"
git push
```

5. **Verify:** Check Vercel Logs next day

**Done!** Your journal is now backed up daily automatically. 🎉
