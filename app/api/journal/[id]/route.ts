import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveJournal } from '@/lib/db';

// PUT /api/journal/[id] - Update an existing journal entry
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const db = await getDb();
    
    const entryId = parseInt(id);
    const entry = db.journal_entries.find(e => e.id === entryId);
    
    if (!entry) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      );
    }
    
    // Update entry fields
    if (body.content !== undefined) entry.content = body.content;
    if (body.myMove !== undefined) entry.myMove = body.myMove;
    if (body.images !== undefined) entry.images = body.images;
    if (body.postReview !== undefined) entry.postReview = body.postReview;
    if (body.aiReview !== undefined) entry.aiReview = body.aiReview;
    
    await saveJournal(db.journal_entries);
    
    return NextResponse.json({
      success: true,
      entry: entry
    });
  } catch (error) {
    console.error('Error updating journal entry:', error);
    return NextResponse.json(
      { error: 'Failed to update entry' },
      { status: 500 }
    );
  }
}

// DELETE /api/journal/[id] - Delete a journal entry
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    
    const entryId = parseInt(id);
    const entryIndex = db.journal_entries.findIndex(e => e.id === entryId);
    
    if (entryIndex === -1) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      );
    }
    
    db.journal_entries.splice(entryIndex, 1);
    await saveJournal(db.journal_entries);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting journal entry:', error);
    return NextResponse.json(
      { error: 'Failed to delete entry' },
      { status: 500 }
    );
  }
}
