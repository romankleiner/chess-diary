import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export async function GET(request: NextRequest) {
  try {
    const { isAdmin: admin } = await isAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await getDb();
    
    // Create a complete backup of the database
    const backup = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      data: {
        settings: db.settings,
        journal_entries: db.journal_entries,
        games: db.games || []
      }
    };
    
    // Return as downloadable JSON file
    const filename = `chess-diary-backup-${new Date().toISOString().split('T')[0]}.json`;
    
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    return NextResponse.json(
      { error: 'Failed to create backup' },
      { status: 500 }
    );
  }
}
