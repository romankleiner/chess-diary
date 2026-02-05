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
          
          // Timestamp at the start
          const timestamp = new Date(entry.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
          });
          
          // Timestamp + Game info on same line (if game exists)
          if (game) {
            docSections.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `[${timestamp}] `, italics: true, size: 22, color: '666666' }), // 11pt, gray
                  new TextRun({ text: `Game: `, bold: true, size: 24 }), // 12pt
                  new TextRun({ text: `${game.white} vs ${game.black}`, size: 24 }),
                ],
                spacing: { before: 300, after: 100 }
              })
            );
          } else {
            // Just timestamp if no game
            docSections.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `[${timestamp}]`, italics: true, size: 22, color: '666666' }), // 11pt, gray
                ],
                spacing: { before: 300, after: 100 }
              })
            );
          }
          
          // Chess board diagram (if FEN exists)
          const fenToUse = entry.fen || (game && game.fen);
          if (fenToUse) {
            try {
              const { ImageRun } = await import('docx');
              const sharp = await import('sharp');
              
              // Fetch board image from chessvision.ai
              const isWhite = game && username && game.white.toLowerCase() === username.toLowerCase();
              const pov = isWhite ? 'white' : 'black';
              const boardUrl = `https://fen2image.chessvision.ai/${encodeURIComponent(fenToUse)}?colors=brown&piece_set=merida&coordinates=true&orientation=${pov}`;
              
              const response = await fetch(boardUrl);
              if (!response.ok) throw new Error('Failed to fetch board image');
              
              const arrayBuffer = await response.arrayBuffer();
              const imageBuffer = Buffer.from(arrayBuffer);
              
              // Compress the board image
              const optimizedBuffer = await sharp.default(imageBuffer)
                .resize(400, null, { withoutEnlargement: true })
                .jpeg({ quality: 65, chromaSubsampling: '4:2:0' })
                .toBuffer();
              
              // Get image dimensions
              const metadata = await sharp.default(optimizedBuffer).metadata();
              const imgWidth = 300;
              const imgHeight = metadata.height && metadata.width 
                ? Math.round((metadata.height / metadata.width) * imgWidth)
                : 300; // Fallback to square for chess boards
              
              docSections.push(
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: Uint8Array.from(optimizedBuffer),
                      transformation: { width: imgWidth, height: imgHeight },
                      type: 'jpg',
                    }),
                  ],
                  spacing: { after: 150 }
                })
              );
            } catch (error) {
              console.error('Error adding chess board:', error);
              docSections.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: '[Chess board diagram could not be generated]', italics: true, color: '999999', size: 20 }),
                  ],
                  spacing: { after: 100 }
                })
              );
            }
          }
          
          // Entry content - larger font
          docSections.push(
            new Paragraph({
              children: [
                new TextRun({ text: entry.content, size: 26 }), // 13pt - larger and more readable
              ],
              spacing: { after: 120 }
            })
          );
          
          // My Move (if exists)
          if (entry.myMove) {
            docSections.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `My Move: `, bold: true, size: 24 }),
                  new TextRun({ text: entry.myMove, size: 24 }),
                ],
                spacing: { after: 120 }
              })
            );
          }
          
          // Manually pasted image (if exists)
          if (entry.image) {
            try {
              const { ImageRun } = await import('docx');
              const sharp = await import('sharp');
              
              const base64Data = entry.image.split(',')[1] || entry.image;
              const imageBuffer = Buffer.from(base64Data, 'base64');
              
              const optimizedBuffer = await sharp.default(imageBuffer)
                .resize(500, null, { withoutEnlargement: true })
                .jpeg({ quality: 60, chromaSubsampling: '4:2:0' })
                .toBuffer();
              
              // Get image dimensions to preserve aspect ratio
              const metadata = await sharp.default(optimizedBuffer).metadata();
              const imgWidth = 400;
              const imgHeight = metadata.height && metadata.width 
                ? Math.round((metadata.height / metadata.width) * imgWidth)
                : 300; // Fallback height
              
              docSections.push(
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: Uint8Array.from(optimizedBuffer),
                      transformation: { width: imgWidth, height: imgHeight },
                      type: 'jpg',
                    }),
                  ],
                  spacing: { after: 200 }
                })
              );
            } catch (error) {
              console.error('Error adding pasted image:', error);
            }
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
      
      return new NextResponse(new Uint8Array(buffer), {
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