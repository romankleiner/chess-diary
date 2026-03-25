import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';
import { isAdmin } from '@/lib/admin';

export async function GET() {
  try {
    const { isAdmin: admin } = await isAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

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
