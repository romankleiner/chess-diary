import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { pruneBackups } from '@/lib/backup-prune';

export async function POST() {
  try {
    const { isAdmin: admin } = await isAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const result = await pruneBackups();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[PRUNE] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Prune failed' },
      { status: 500 }
    );
  }
}
