import { NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function GET() {
  try {
    const db = await getDb() as any;
    
    // Calculate sizes of different data types
    const sizes = {
      journal_entries: {
        count: db.journal_entries?.length || 0,
        estimatedSizeBytes: JSON.stringify(db.journal_entries || []).length,
        estimatedSizeMB: (JSON.stringify(db.journal_entries || []).length / 1024 / 1024).toFixed(2),
        withImages: db.journal_entries?.filter((e: any) => e.images?.length > 0 || e.image).length || 0,
      },
      games: {
        count: Object.keys(db.games || {}).length,
        estimatedSizeBytes: JSON.stringify(db.games || {}).length,
        estimatedSizeMB: (JSON.stringify(db.games || {}).length / 1024 / 1024).toFixed(2),
      },
      game_analyses: {
        count: Object.keys(db.game_analyses || {}).length,
        estimatedSizeBytes: JSON.stringify(db.game_analyses || {}).length,
        estimatedSizeMB: (JSON.stringify(db.game_analyses || {}).length / 1024 / 1024).toFixed(2),
      },
      analysis_progress: {
        count: Object.keys(db.analysis_progress || {}).length,
        estimatedSizeBytes: JSON.stringify(db.analysis_progress || {}).length,
        estimatedSizeKB: (JSON.stringify(db.analysis_progress || {}).length / 1024).toFixed(2),
      },
      settings: {
        estimatedSizeBytes: JSON.stringify(db.settings || {}).length,
        estimatedSizeKB: (JSON.stringify(db.settings || {}).length / 1024).toFixed(2),
      },
      total: {
        estimatedSizeBytes: JSON.stringify(db).length,
        estimatedSizeMB: (JSON.stringify(db).length / 1024 / 1024).toFixed(2),
      }
    };
    
    // Check for unusually large items
    const largeEntries: any[] = [];
    db.journal_entries?.forEach((entry: any, index: number) => {
      const entrySize = JSON.stringify(entry).length;
      if (entrySize > 50000) { // > 50KB
        largeEntries.push({
          index,
          id: entry.id,
          date: entry.date,
          sizeBytes: entrySize,
          sizeKB: (entrySize / 1024).toFixed(2),
          hasImages: !!entry.images?.length || !!entry.image,
          imageCount: entry.images?.length || (entry.image ? 1 : 0),
          hasPostReview: !!entry.postReview,
          hasAiReview: !!entry.aiReview,
        });
      }
    });
    
    // Sort by size descending
    largeEntries.sort((a, b) => b.sizeBytes - a.sizeBytes);
    
    return NextResponse.json({
      summary: {
        totalSizeMB: sizes.total.estimatedSizeMB,
        journalEntriesCount: sizes.journal_entries.count,
        entriesWithImages: sizes.journal_entries.withImages,
        gamesCount: sizes.games.count,
        analysesCount: sizes.game_analyses.count,
      },
      sizes,
      largeEntries: largeEntries.slice(0, 10), // Top 10 largest
      recommendations: largeEntries.length > 0 
        ? [
            `Found ${largeEntries.length} entries over 50KB`,
            'Base64 images in journal entries are the likely cause',
            'Consider implementing image cleanup or external storage',
            `Largest entry: ${largeEntries[0]?.sizeKB}KB (${largeEntries[0]?.imageCount} images)`
          ]
        : ['Database size looks normal']
    });
  } catch (error) {
    console.error('Error debugging Redis:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to debug Redis' },
      { status: 500 }
    );
  }
}
