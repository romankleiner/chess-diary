import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate') || '2020-01-01';
    const endDate = searchParams.get('endDate');
    const format = searchParams.get('format') || 'json'; // json or docx
    const username = searchParams.get('username') || '';
    
    if (!endDate) {
      return NextResponse.json(
        { error: 'Missing endDate parameter' },
        { status: 400 }
      );
    }
    
    const db = await getDb();
    
    // Get all entries within date range, sorted chronologically (oldest first)
    const entries = db.journal_entries
      .filter(e => e.date >= startDate && e.date <= endDate)
      .sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
    
    // Group by date
    const groupedByDate: Record<string, any[]> = {};
    entries.forEach(entry => {
      if (!groupedByDate[entry.date]) {
        groupedByDate[entry.date] = [];
      }
      groupedByDate[entry.date].push(entry);
    });
    
    const groupedData = Object.keys(groupedByDate).sort().map(date => ({
      date,
      entries: groupedByDate[date].map(entry => ({
        ...entry,
        game: entry.gameId ? db.games[entry.gameId] : null
      }))
    }));
    
    if (format === 'docx') {
      // Generate Word document in-memory using docx library
      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
      
      // Create document sections
      const docSections: any[] = [
        new Paragraph({
          text: `Chess Journal Export`,
          heading: HeadingLevel.TITLE,
        }),
        new Paragraph({
          text: `Date Range: ${startDate} to ${endDate}`,
          spacing: { after: 200 }
        }),
        new Paragraph({ text: '' }), // Empty line
      ];
      
      // Add entries by date
      for (const { date, entries: dateEntries } of groupedData) {
        // Date header
        docSections.push(
          new Paragraph({
            text: new Date(date).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            }),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 }
          })
        );
        
        // Add each entry
        for (const entry of dateEntries) {
          const game = entry.game;
          
          if (game) {
            // Game info
            docSections.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `Game: `, bold: true }),
                  new TextRun({ text: `${game.white} vs ${game.black}` }),
                ],
                spacing: { before: 200 }
              })
            );
          }
          
          // Entry content
          const timestamp = new Date(entry.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
          });
          
          docSections.push(
            new Paragraph({
              children: [
                new TextRun({ text: `[${timestamp}] `, italics: true }),
                new TextRun({ text: entry.content }),
              ],
              spacing: { after: 100 }
            })
          );
          
          if (entry.myMove) {
            docSections.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `My Move: `, bold: true }),
                  new TextRun({ text: entry.myMove }),
                ],
                spacing: { after: 100 }
              })
            );
          }
        }
      }
      
      // Create document
      const doc = new Document({
        sections: [{
          children: docSections
        }]
      });
      
      // Generate buffer
      const buffer = await Packer.toBuffer(doc);
      
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="chess-journal-${startDate}-to-${endDate}.docx"`
        }
      });
    }
    
    // Return JSON for client-side text export
    return NextResponse.json({ 
      entries: entries.map(entry => ({
        ...entry,
        game: entry.gameId ? db.games[entry.gameId] : null
      })),
      groupedByDate: groupedData
    });
  } catch (error) {
    console.error('Error exporting journal:', error);
    return NextResponse.json(
      { error: 'Failed to export journal' },
      { status: 500 }
    );
  }
}