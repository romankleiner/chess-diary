import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

// Delete a journal entry by ID
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const entryId = parseInt(id);
    
    if (isNaN(entryId)) {
      return NextResponse.json(
        { error: 'Invalid entry ID' },
        { status: 400 }
      );
    }
    
    const db = await getDb();
    
    // Find the entry index
    const entryIndex = db.journal_entries.findIndex(e => e.id === entryId);
    
    if (entryIndex === -1) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      );
    }
    
    // Remove the entry
    db.journal_entries.splice(entryIndex, 1);
    await saveDb(db);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting journal entry:', error);
    return NextResponse.json(
      { error: 'Failed to delete journal entry' },
      { status: 500 }
    );
  }
}

// Update a journal entry by ID
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const entryId = parseInt(id);
    
    if (isNaN(entryId)) {
      return NextResponse.json(
        { error: 'Invalid entry ID' },
        { status: 400 }
      );
    }
    
    const body = await request.json();
    const { content, myMove, image } = body;
    
    const db = await getDb();
    
    // Find the entry
    const entry = db.journal_entries.find(e => e.id === entryId);
    
    if (!entry) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      );
    }
    
    // Update fields
    if (content !== undefined) entry.content = content;
    if (myMove !== undefined) entry.myMove = myMove;
    if (image !== undefined) entry.image = image;
    
    await saveDb(db);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating journal entry:', error);
    return NextResponse.json(
      { error: 'Failed to update journal entry' },
      { status: 500 }
    );
  }
}
