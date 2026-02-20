import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

// GET /api/settings - Get all settings
export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    
    return NextResponse.json({
      settings: db.settings || {}
    });
  } catch (error) {
    console.error('Error loading settings:', error);
    return NextResponse.json(
      { error: 'Failed to load settings' },
      { status: 500 }
    );
  }
}

// PUT /api/settings - Update settings
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const db = await getDb();
    
    if (!db.settings) {
      db.settings = {};
    }
    
    // Update settings - merge with existing
    db.settings = {
      ...db.settings,
      ...body
    };
    
    await saveDb(db);
    
    return NextResponse.json({
      success: true,
      settings: db.settings
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}