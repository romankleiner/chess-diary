import { NextRequest, NextResponse } from 'next/server';
import { getJournalEntry, saveJournalEntry, deleteJournalEntry } from '@/lib/db';

// PUT /api/journal/[id] - Update an existing journal entry
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const entryId = parseInt(id);
    const entry = await getJournalEntry(entryId);
    
    if (!entry) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      );
    }
    
    // Update entry fields
    if (body.content !== undefined) entry.content = body.content;
    if (body.myMove !== undefined) entry.myMove = body.myMove;
    if (body.moveNotation !== undefined) entry.moveNotation = body.moveNotation;
    if (body.moveNumber !== undefined) entry.moveNumber = body.moveNumber;
    if (body.images !== undefined) entry.images = body.images;
    if (body.postReview !== undefined) entry.postReview = body.postReview;
    if (body.aiReview !== undefined) entry.aiReview = body.aiReview;
    
    await saveJournalEntry(entry);
    
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
    const entryId = parseInt(id);
    const entry = await getJournalEntry(entryId);
    
    if (!entry) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      );
    }
    
    await deleteJournalEntry(entryId);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting journal entry:', error);
    return NextResponse.json(
      { error: 'Failed to delete entry' },
      { status: 500 }
    );
  }
}
