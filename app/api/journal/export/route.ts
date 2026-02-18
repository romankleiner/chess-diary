import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

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
                spacing: { before: 200, after: 100 }
              })
            );
          }
          
          // Add chess diagram from FEN or cached images (BEFORE entry content)
          // Priority: 1) Check cached images, 2) Generate from FEN if available
          if (entry.fen || entry.images?.length > 0 || entry.image) {
            try {
              const { ImageRun } = await import('docx');
              let imageBuffer: Buffer | null = null;
              
              // Try cached images first
              const cachedImage = entry.images?.[0] || entry.image;
              if (cachedImage) {
                const base64Data = cachedImage.split(',')[1] || cachedImage;
                imageBuffer = Buffer.from(base64Data, 'base64');
                console.log(`[EXPORT] Entry ${entry.id}: Using cached board image`);
              } 
              // Generate from FEN if no cached image but FEN exists
              else if (entry.fen) {
                console.log(`[EXPORT] Entry ${entry.id}: Generating board from FEN: ${entry.fen}`);
                
                // Determine POV (point of view) - which side the user is playing
                let pov = 'white'; // default
                if (game && username) {
                  const usernameLower = username.toLowerCase();
                  if (game.black.toLowerCase() === usernameLower) {
                    pov = 'black';
                  }
                }
                
                const boardUrl = `${request.nextUrl.origin}/api/board-image?fen=${encodeURIComponent(entry.fen)}&pov=${pov}`;
                console.log(`[EXPORT] Fetching: ${boardUrl}`);
                
                const boardResponse = await fetch(boardUrl);
                
                if (boardResponse.ok) {
                  const arrayBuffer = await boardResponse.arrayBuffer();
                  imageBuffer = Buffer.from(arrayBuffer);
                  
                  // Cache the generated image back to the entry for future exports
                  // Convert to base64 data URL
                  const base64 = imageBuffer.toString('base64');
                  const dataUrl = `data:image/png;base64,${base64}`;
                  
                  // Update entry in database
                  if (!entry.images) {
                    entry.images = [dataUrl];
                  } else if (!entry.images[0]) {
                    entry.images[0] = dataUrl;
                  }
                  console.log(`[EXPORT] Entry ${entry.id}: Cached generated image (${imageBuffer.length} bytes)`);
                } else {
                  const errorText = await boardResponse.text();
                  console.error(`[EXPORT] Entry ${entry.id}: Failed to generate board - ${boardResponse.status}: ${errorText}`);
                }
              }
              
              // Add image to document if we have one
              if (imageBuffer) {
                docSections.push(
                  new Paragraph({
                    children: [
                      new ImageRun({
                        data: Uint8Array.from(imageBuffer),
                        transformation: {
                          width: 300,
                          height: 300,
                        },
                      } as any),
                    ],
                    spacing: { after: 200 }
                  })
                );
              } else if (entry.fen) {
                // Add FEN text if image couldn't be generated
                docSections.push(
                  new Paragraph({
                    children: [
                      new TextRun({ text: 'Position (FEN): ', bold: true }),
                      new TextRun({ text: entry.fen, italics: true, size: 18 }),
                    ],
                    spacing: { after: 200 }
                  })
                );
              }
            } catch (error) {
              console.error(`[EXPORT] Entry ${entry.id}: Error adding chess diagram:`, error);
              docSections.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: '[Chess diagram unavailable]', italics: true, color: '999999' }),
                  ],
                  spacing: { after: 100 }
                })
              );
            }
          }
          
          // Entry content (AFTER chess diagram)
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
          
          // Add additional user-uploaded images (if any beyond the first board image)
          // If we already added a board from images[0], skip it here
          const hasBoardInFirstImage = entry.images?.length > 0 && !entry.fen;
          const entryImages = entry.images && entry.images.length > 0
            ? (hasBoardInFirstImage ? entry.images : entry.images.slice(1))
            : entry.image && !entry.fen
              ? [entry.image]
              : [];
          
          console.log(`[EXPORT] Entry ${entry.id}: Found ${entryImages.length} additional user image(s)`);
          
          if (entryImages.length > 0) {
            try {
              const { ImageRun } = await import('docx');
              
              for (const [index, img] of entryImages.entries()) {
                // Remove data URL prefix
                const base64Data = img.split(',')[1] || img;
                const imageBuffer = Buffer.from(base64Data, 'base64');
                
                console.log(`[EXPORT] Adding image ${index + 1}/${entryImages.length} - size: ${imageBuffer.length} bytes`);
                
                docSections.push(
                  new Paragraph({
                    children: [
                      new ImageRun({
                        data: Uint8Array.from(imageBuffer),
                        transformation: {
                          width: 400,
                          height: 300,
                        },
                      } as any), // Type assertion to work around docx type issues
                    ],
                    spacing: { after: entryImages.length > 1 ? 100 : 200 }
                  })
                );
              }
              console.log(`[EXPORT] Successfully added ${entryImages.length} image(s) to entry ${entry.id}`);
            } catch (error) {
              console.error('[EXPORT] Error adding images to document:', error);
              // Add a note that images couldn't be included
              docSections.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: '[Image could not be included]', italics: true, color: '999999' }),
                  ],
                  spacing: { after: 100 }
                })
              );
            }
          }
          
          // Add post-review if present
          if (entry.postReview) {
            const { Table, TableRow, TableCell, WidthType, Shading } = await import('docx');
            
            const reviewDate = new Date(entry.postReview.timestamp);
            const entryDate = new Date(entry.timestamp);
            const daysDiff = Math.floor((reviewDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
            const timeLabel = daysDiff === 0 ? 'same day' : 
                            daysDiff === 1 ? '1 day after game' : 
                            `${daysDiff} days after game`;
            
            // Add spacing before review box
            docSections.push(new Paragraph({ spacing: { after: 100 } }));
            
            // Create shaded table for post-review
            docSections.push(
              new Table({
                width: { size: 90, type: WidthType.PERCENTAGE },
                indent: { size: 720, type: WidthType.DXA }, // 0.5 inch indent
                borders: {
                  top: { style: 'single', size: 2, color: 'D97706' },
                  bottom: { style: 'single', size: 2, color: 'D97706' },
                  left: { style: 'single', size: 2, color: 'D97706' },
                  right: { style: 'single', size: 2, color: 'D97706' },
                },
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        shading: { fill: 'FEF3C7' }, // Amber-100
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({ text: '📝 POST-GAME REVIEW', bold: true, size: 22 })
                            ],
                            spacing: { after: 100 }
                          }),
                          new Paragraph({
                            children: [
                              new TextRun({ text: `Added ${timeLabel}`, size: 18, italics: true, color: '92400E' })
                            ],
                            spacing: { after: 150 }
                          }),
                          new Paragraph({
                            border: { bottom: { style: 'single', size: 1, color: 'F59E0B' } },
                            spacing: { after: 150 }
                          }),
                          new Paragraph({
                            children: [
                              new TextRun({ text: entry.postReview.content, italics: true })
                            ]
                          })
                        ]
                      })
                    ]
                  })
                ]
              })
            );
          }
        }
      }
      
      // Save any cached images we generated back to the database
      await saveDb(db);
      console.log('[EXPORT] Saved cached board images to database');
      
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