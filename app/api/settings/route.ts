import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/db';

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
    const settings = await getSettings();
    
    // Update settings - merge with existing
    const updated = {
      ...settings,
      ...body
    };
    
    await saveSettings(updated);
    
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
