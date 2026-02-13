import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { getCachedBoardImage } from '@/lib/board-image-cache';

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
    
    // Get font settings
    const exportFont = db.settings.export_font || 'Calibri';
    const exportFontSize = parseInt(db.settings.export_font_size || '11');
    const fontSize = exportFontSize * 2; // Convert pt to half-points for docx
    
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
          children: [
            new TextRun({ 
              text: `Date Range: ${startDate} to ${endDate}`,
              font: exportFont,
              size: fontSize
            })
          ],
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
          
          // Chess board diagram (if FEN exists) - show before content for game entries
          const fenToUse = entry.fen || (game && game.fen);
          if (game && fenToUse) {
            // For game entries, show timestamp + game info, then board
            docSections.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `[${timestamp}] `, italics: true, size: fontSize, color: '666666', font: exportFont }),
                  new TextRun({ text: `Game: `, bold: true, size: fontSize, font: exportFont }),
                  new TextRun({ text: `${game.white} vs ${game.black}`, size: fontSize, font: exportFont }),
                ],
                spacing: { before: 300, after: 100 }
              })
            );
            
            try {
              const { ImageRun } = await import('docx');
              const sharp = await import('sharp');
              
              // Fetch board image from cache
              const isWhite = username && game.white.toLowerCase() === username.toLowerCase();
              const pov = isWhite ? 'white' : 'black';
              
              const imageBuffer = await getCachedBoardImage(fenToUse, pov);
              
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
                : 300;
              
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
          
          // Entry content with hyperlink support and line breaks
          // Split by paragraphs first (double newlines)
          const paragraphs = entry.content.split(/\n\n+/);
          
          // First paragraph handling - merge with timestamp for general entries
          const firstParagraphLines = paragraphs[0].split('\n');
          
          // Build first line with timestamp
          for (let l = 0; l < firstParagraphLines.length; l++) {
            const line = firstParagraphLines[l];
            const contentChildren: any[] = [];
            
            // Add timestamp only on the very first line, and only for non-game entries
            if (l === 0 && !game) {
              contentChildren.push(
                new TextRun({ text: `[${timestamp}] `, italics: true, size: fontSize, color: '666666', font: exportFont })
              );
            }
            
            // Add content for this line
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const contentParts = line.split(urlRegex);
            
            // Check if this line is a bullet point
            const bulletMatch = line.match(/^(\s*)([-*•])\s+(.+)$/);
            let isBullet = false;
            let bulletIndent = 0;
            let bulletText = line;
            
            if (bulletMatch) {
              isBullet = true;
              bulletIndent = Math.floor(bulletMatch[1].length / 2); // Indent level (2 spaces = 1 level)
              bulletText = bulletMatch[3]; // Text after bullet
              
              // Re-split the bullet text for URL processing
              const bulletParts = bulletText.split(urlRegex);
              
              for (const part of bulletParts) {
                if (part.match(urlRegex)) {
                  const { ExternalHyperlink } = await import('docx');
                  contentChildren.push(
                    new ExternalHyperlink({
                      children: [
                        new TextRun({ 
                          text: part, 
                          size: fontSize, 
                          font: exportFont,
                          color: '0563C1',
                          underline: {}
                        })
                      ],
                      link: part
                    })
                  );
                } else if (part) {
                  contentChildren.push(
                    new TextRun({ text: part, size: fontSize, font: exportFont })
                  );
                }
              }
            } else {
              // Not a bullet - process normally
              for (const part of contentParts) {
                if (part.match(urlRegex)) {
                  const { ExternalHyperlink } = await import('docx');
                  contentChildren.push(
                    new ExternalHyperlink({
                      children: [
                        new TextRun({ 
                          text: part, 
                          size: fontSize, 
                          font: exportFont,
                          color: '0563C1',
                          underline: {}
                        })
                      ],
                      link: part
                    })
                  );
                } else if (part) {
                  contentChildren.push(
                    new TextRun({ text: part, size: fontSize, font: exportFont })
                  );
                }
              }
            }
            
            // Determine spacing for first paragraph lines
            let afterSpacing = 0;
            if (l === firstParagraphLines.length - 1) {
              // Last line of first paragraph
              if (paragraphs.length === 1) {
                afterSpacing = 120; // Only paragraph - space after entry
              } else {
                afterSpacing = 240; // More paragraphs - paragraph break
              }
            }
            
            docSections.push(
              new Paragraph({
                children: contentChildren,
                bullet: isBullet ? { level: bulletIndent } : undefined,
                spacing: { 
                  before: (l === 0 && !game) ? 300 : 0, // Space before first line only for non-game entries
                  after: afterSpacing,
                  line: 276
                }
              })
            );
          }
          
          // Handle remaining paragraphs (if any)
          for (let p = 1; p < paragraphs.length; p++) {
            const paragraphText = paragraphs[p];
            const lines = paragraphText.split('\n');
            
            for (let l = 0; l < lines.length; l++) {
              const line = lines[l];
              const contentChildren: any[] = [];
              const urlRegex = /(https?:\/\/[^\s]+)/g;
              const contentParts = line.split(urlRegex);
              
              // Check if this line is a bullet point
              const bulletMatch = line.match(/^(\s*)([-*•])\s+(.+)$/);
              let isBullet = false;
              let bulletIndent = 0;
              let bulletText = line;
              
              if (bulletMatch) {
                isBullet = true;
                bulletIndent = Math.floor(bulletMatch[1].length / 2);
                bulletText = bulletMatch[3];
                
                const bulletParts = bulletText.split(urlRegex);
                
                for (const part of bulletParts) {
                  if (part.match(urlRegex)) {
                    const { ExternalHyperlink } = await import('docx');
                    contentChildren.push(
                      new ExternalHyperlink({
                        children: [
                          new TextRun({ 
                            text: part, 
                            size: fontSize, 
                            font: exportFont,
                            color: '0563C1',
                            underline: {}
                          })
                        ],
                        link: part
                      })
                    );
                  } else if (part) {
                    contentChildren.push(
                      new TextRun({ text: part, size: fontSize, font: exportFont })
                    );
                  }
                }
              } else {
                // Not a bullet
                for (const part of contentParts) {
                  if (part.match(urlRegex)) {
                    const { ExternalHyperlink } = await import('docx');
                    contentChildren.push(
                      new ExternalHyperlink({
                        children: [
                          new TextRun({ 
                            text: part, 
                            size: fontSize, 
                            font: exportFont,
                            color: '0563C1',
                            underline: {}
                          })
                        ],
                        link: part
                      })
                    );
                  } else if (part) {
                    contentChildren.push(
                      new TextRun({ text: part, size: fontSize, font: exportFont })
                    );
                  }
                }
              }
              
              let afterSpacing = 0;
              if (l === lines.length - 1) {
                if (p === paragraphs.length - 1) {
                  afterSpacing = 120;
                } else {
                  afterSpacing = 240;
                }
              }
              
              docSections.push(
                new Paragraph({
                  children: contentChildren.length > 0 ? contentChildren : [new TextRun({ text: '', size: fontSize, font: exportFont })],
                  bullet: isBullet ? { level: bulletIndent } : undefined,
                  spacing: { 
                    after: afterSpacing,
                    line: 276
                  }
                })
              );
            }
          }
          
          // My Move (if exists)
          if (entry.myMove) {
            docSections.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `My Move: `, bold: true, size: fontSize, font: exportFont }),
                  new TextRun({ text: entry.myMove, size: fontSize, font: exportFont }),
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