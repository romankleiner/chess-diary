import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import getDb, { saveDb } from '@/lib/db';

export async function GET() {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const db = await getDb();
    return NextResponse.json({ settings: db.settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { key, value } = body;
    
    if (!key || !value) {
      return NextResponse.json(
        { error: 'Key and value are required' },
        { status: 400 }
      );
    }
    
    const db = await getDb();
    db.settings[key] = value;
    await saveDb(db);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving setting:', error);
    return NextResponse.json(
      { error: 'Failed to save setting' },
      { status: 500 }
    );
  }
}
