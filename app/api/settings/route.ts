import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSetting } from '@/lib/db';

// GET /api/settings - Get all settings
export async function GET(request: NextRequest) {
  try {
    const settings = await getSettings();
    
    return NextResponse.json({
      settings: settings || {}
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
    
    // Write each changed setting individually
    await Promise.all(
      Object.entries(body).map(([key, value]) => saveSetting(key, String(value)))
    );
    
    // Return the full merged settings
    const updated = await getSettings();
    
    return NextResponse.json({
      success: true,
      settings: updated
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
