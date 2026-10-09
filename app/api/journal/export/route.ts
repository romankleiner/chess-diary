import { NextRequest, NextResponse } from 'next/server';
import { getJournal, getGames, getAnalysis, saveJournalEntry } from '@/lib/db';
import { refreshSummaryAccuracy } from '@/lib/summary-accuracy';
import { getCachedBoardImage } from '@/lib/board-image-storage';

export const maxDuration = 60; // Vercel Pro allows up to 60s — large exports need the room

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate') || '2020-01-01';
    const endDate = searchParams.get('endDate');
    const format = searchParams.get('format') || 'json'; // json or docx
    const username = searchParams.get('username') || '';
    const includePostReviews = searchParams.get('includePostReviews') !== 'false'; // Default true

    if (!endDate) {
      return NextResponse.json(
        { error: 'Missing endDate parameter' },
        { status: 400 }
      );
    }

    const [journalEntries, games] = await Promise.all([
      getJournal(),
      getGames(),
    ]);

    // Get all entries within date range, sorted chronologically (oldest first)
    const inRange = journalEntries
      .filter(e => e.date >= startDate && e.date <= endDate)
      .sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });

    // A post-game summary saved its accuracy when it was written, under whatever formula
    // was in use then. Show the analysis's current figure, as the journal page does.
    let entries = inRange;
    try {
      entries = await refreshSummaryAccuracy(inRange, gameId => getAnalysis(gameId));
    } catch (error) {
      console.error('[EXPORT] Could not refresh summary accuracy:', error instanceof Error ? error.message : error);
    }

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
        game: entry.gameId ? games[entry.gameId] : null
      }))
    }));

    if (format === 'docx') {
      // Streamed NDJSON response: one {"type":"progress",...} line per entry
      // processed, then a final {"type":"done",...} line carrying the finished
      // docx as base64. Board-diagram generation below hits an external service
      // (chessvision.ai) sequentially and by design — parallelizing risks
      // rate-limiting it — so for a large journal this can take a while.
      // Streaming progress lets the client show real feedback without a second
      // polling endpoint.
      type ExportMessage =
        | { type: 'progress'; current: number; total: number }
        | { type: 'done'; filename: string; data: string }
        | { type: 'error'; message: string };

      const encoder = new TextEncoder();
      // Unique ids, to match the dedup guard in the loop below — otherwise a
      // skipped duplicate would leave the progress bar short of 100%.
      const totalEntries = new Set(entries.map(e => e.id)).size;

      const stream = new ReadableStream({
        async start(controller) {
          const send = (message: ExportMessage) =>
            controller.enqueue(encoder.encode(JSON.stringify(message) + '\n'));

          try {
            const { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, BorderStyle, ImageRun } = await import('docx');

            // Track processed entries to prevent duplicates
            const processedEntryIds = new Set<number>();

            // Entries whose images[0] we just populated with a freshly-generated
            // board diagram — only these get written back to Redis, instead of
            // the whole journal, so an export doesn't rewrite every entry.
            const entriesToPersist = new Map<number, any>();

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

            let current = 0;

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
                // Skip if already processed
                if (processedEntryIds.has(entry.id)) {
                  continue;
                }
                processedEntryIds.add(entry.id);

                const game = entry.game;

                // Compute timestamp once here so both the header and content sections can use it
                const timestamp = new Date(entry.timestamp).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit'
                });

                if (game && entry.entryType !== 'post_game_summary') {
                  // Game info + timestamp on the same line (timestamp before the diagram)
                  docSections.push(
                    new Paragraph({
                      children: [
                        new TextRun({ text: `Game: `, bold: true }),
                        new TextRun({ text: `${game.white} vs ${game.black}` }),
                        new TextRun({ text: `  ·  `, color: '999999' }),
                        new TextRun({ text: timestamp, italics: true, color: '666666' }),
                      ],
                      spacing: { before: 200, after: 100 }
                    })
                  );
                }

                // Add chess diagram from FEN or cached images (BEFORE entry content)
                // Priority: 1) Check cached images, 2) Generate from FEN if available
                // Skip for post-game summaries — they have no FEN or board position
                // Only use images[0] as board if entry actually has a FEN
                let usedFirstImageAsBoard = false;
                if (entry.entryType !== 'post_game_summary' && entry.fen) {
                  try {
                    let imageBuffer: Buffer | null = null;

                    // Try cached board image first (images[0] is reserved for board diagrams)
                    const cachedImage = entry.images?.[0];
                    if (cachedImage) {
                      const base64Data = cachedImage.split(',')[1] || cachedImage;
                      imageBuffer = Buffer.from(base64Data, 'base64');
                      usedFirstImageAsBoard = true; // Mark that we used images[0]
                    }
                    // Generate from FEN if no cached image but FEN exists
                    else if (entry.fen) {
                      // Determine POV (point of view) - which side the user is playing
                      let pov = 'white'; // default
                      if (game && username) {
                        const usernameLower = username.toLowerCase();
                        if (game.black.toLowerCase() === usernameLower) {
                          pov = 'black';
                        }
                      }

                      // Straight from the store, making the image if need be -- not
                      // through the public endpoint, which makes new images only for
                      // a signed-in browser. A failure leaves the position as text below.
                      const boardResponse = await getCachedBoardImage(entry.fen, pov === 'black' ? 'black' : 'white')
                        .then(url => fetch(url))
                        .catch((error: unknown) => {
                          console.error(`[EXPORT] Entry ${entry.id}: Failed to generate board -`, error instanceof Error ? error.message : error);
                          return null;
                        });
                      if (boardResponse?.ok) {
                        const arrayBuffer = await boardResponse.arrayBuffer();
                        imageBuffer = Buffer.from(arrayBuffer);

                        // Cache the generated image back to the entry for future exports
                        const base64 = imageBuffer.toString('base64');
                        const dataUrl = `data:image/png;base64,${base64}`;

                        // Find and update the ORIGINAL entry in db.journal_entries
                        const originalEntry = journalEntries.find(e => e.id === entry.id);
                        if (originalEntry) {
                          if (!originalEntry.images) {
                            originalEntry.images = [dataUrl];
                          } else if (!originalEntry.images[0]) {
                            originalEntry.images[0] = dataUrl;
                          }
                          entriesToPersist.set(originalEntry.id, originalEntry);
                        }
                      } else if (boardResponse) {
                        const errorText = await boardResponse.text();
                        console.error(`[EXPORT] Entry ${entry.id}: Failed to generate board - ${boardResponse.status}: ${errorText}`);
                      }
                    }

                    // Add image to document if we have one
                    if (imageBuffer) {
                      try {
                        docSections.push(
                          new Paragraph({
                            children: [
                              new ImageRun({
                                data: imageBuffer,
                                transformation: {
                                  width: 240,
                                  height: 240,
                                },
                                type: 'png',
                              }),
                            ],
                            spacing: { after: 200 }
                          })
                        );
                      } catch (imgError: any) {
                        console.error(`[EXPORT] Failed to add board image for entry ${entry.id}:`, imgError.message);
                      }
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
                if (entry.entryType === 'post_game_summary') {
                  // ── Post-game summary card ─────────────────────────────────────────
                  // Mirrors the blue card UI with a shaded header, stats box, and
                  // colour-coded reflection sections.
                  const pg = entry.postGameSummary;
                  const snap = entry.gameSnapshot;
                  const chessUrl = snap?.url || (game ? game.url : null);

                  const opponent = snap?.opponent || (game ? game.opponent : '');
                  const result   = snap?.result   || '';
                  const resultLabel = result ? ` · ${result.charAt(0).toUpperCase() + result.slice(1)}` : '';
                  const s = pg?.statistics;
                  const accuracyText = s?.accuracy != null ? `  ·  ${s.accuracy}% accuracy` : '';

                  // Helper: border spec (left thick stripe + optional top/bottom hairline)
                  const borderSpec = (color: string, opts: { top?: boolean; bottom?: boolean } = {}) => ({
                    left: { style: BorderStyle.SINGLE, size: 18, color, space: 4 },
                    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    ...(opts.top    ? { top:    { style: BorderStyle.SINGLE, size: 4, color, space: 1 } } : {}),
                    ...(opts.bottom ? { bottom: { style: BorderStyle.SINGLE, size: 4, color, space: 1 } } : {}),
                  });

                  // ── Blue header ──────────────────────────────────────────────────
                  docSections.push(
                    new Paragraph({
                      children: [
                        new TextRun({ text: '🏁  POST-GAME SUMMARY', bold: true, size: 28, color: '1E40AF' }),
                      ],
                      shading: { fill: 'DBEAFE' },
                      border: borderSpec('1D4ED8', { top: true }),
                      indent: { left: 240, right: 240 },
                      spacing: { before: 360, after: 0 },
                    })
                  );
                  docSections.push(
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: opponent ? `vs. ${opponent}${resultLabel}${accuracyText}` : resultLabel.replace(/^ · /, ''),
                          size: 22,
                          color: '1D4ED8',
                        }),
                        new TextRun({ text: `  ·  ${timestamp}`, size: 22, color: '3B82F6', italics: true }),
                      ],
                      shading: { fill: 'DBEAFE' },
                      border: borderSpec('1D4ED8', { bottom: !chessUrl }),
                      indent: { left: 240, right: 240 },
                      spacing: { before: 40, after: 0 },
                    })
                  );
                  if (chessUrl) {
                    docSections.push(
                      new Paragraph({
                        children: [
                          new ExternalHyperlink({
                            link: chessUrl,
                            children: [
                              new TextRun({ text: '♟  View on Chess.com', color: '2563EB', underline: {}, size: 19 }),
                            ],
                          }),
                        ],
                        shading: { fill: 'DBEAFE' },
                        border: borderSpec('1D4ED8', { bottom: true }),
                        indent: { left: 240, right: 240 },
                        spacing: { before: 60, after: 0 },
                      })
                    );
                  }

                  // ── Stats box ────────────────────────────────────────────────────
                  if (s) {
                    docSections.push(
                      new Paragraph({
                        children: [new TextRun({ text: 'GAME PERFORMANCE', bold: true, size: 18, color: '6B7280', allCaps: true })],
                        shading: { fill: 'EFF6FF' },
                        border: borderSpec('3B82F6', { top: true }),
                        indent: { left: 240, right: 240 },
                        spacing: { before: 200, after: 0 },
                      })
                    );

                    // Row 1 – neutral stats
                    const row1: any[] = [];
                    if (s.accuracy != null) {
                      row1.push(new TextRun({ text: 'Accuracy ', color: '6B7280', size: 20 }));
                      row1.push(new TextRun({ text: `${s.accuracy}%`, bold: true, size: 20, color: '111827' }));
                    }
                    if (s.totalMoves) {
                      if (row1.length) row1.push(new TextRun({ text: '      ', size: 20 }));
                      row1.push(new TextRun({ text: 'Moves ', color: '6B7280', size: 20 }));
                      row1.push(new TextRun({ text: `${s.totalMoves}`, bold: true, size: 20, color: '111827' }));
                    }
                    if (s.averageCentipawnLoss != null) {
                      if (row1.length) row1.push(new TextRun({ text: '      ', size: 20 }));
                      row1.push(new TextRun({ text: 'Avg CP Loss ', color: '6B7280', size: 20 }));
                      row1.push(new TextRun({ text: `${s.averageCentipawnLoss}`, bold: true, size: 20, color: '111827' }));
                    }
                    if (row1.length) {
                      docSections.push(new Paragraph({
                        children: row1,
                        shading: { fill: 'EFF6FF' },
                        border: borderSpec('3B82F6'),
                        indent: { left: 240, right: 240 },
                        spacing: { before: 40, after: 0 },
                      }));
                    }

                    // Row 2 – coloured error stats
                    docSections.push(new Paragraph({
                      children: [
                        new TextRun({ text: 'Blunders ', color: '6B7280', size: 20 }),
                        new TextRun({ text: `${s.blunders ?? 0}`, bold: true, size: 20, color: 'DC2626' }),
                        new TextRun({ text: '      Mistakes ', color: '6B7280', size: 20 }),
                        new TextRun({ text: `${s.mistakes ?? 0}`, bold: true, size: 20, color: 'EA580C' }),
                        new TextRun({ text: '      Inaccuracies ', color: '6B7280', size: 20 }),
                        new TextRun({ text: `${s.inaccuracies ?? 0}`, bold: true, size: 20, color: 'CA8A04' }),
                      ],
                      shading: { fill: 'EFF6FF' },
                      border: borderSpec('3B82F6', { bottom: true }),
                      indent: { left: 240, right: 240 },
                      spacing: { before: 40, after: 0 },
                    }));
                  }

                  // ── Reflection sections ──────────────────────────────────────────
                  const reflections = pg?.reflections || {};
                  const reflectionFields = [
                    { key: 'whatWentWell',   icon: '✅', label: 'What Went Well',  fill: 'F0FDF4', color: '16A34A' },
                    { key: 'mistakes',       icon: '❌', label: 'Key Mistakes',    fill: 'FEF2F2', color: 'DC2626' },
                    { key: 'lessonsLearned', icon: '📚', label: 'Lessons Learned', fill: 'EFF6FF', color: '2563EB' },
                    { key: 'nextSteps',      icon: '🎯', label: 'Next Steps',      fill: 'F5F3FF', color: '7C3AED' },
                  ] as const;

                  for (const { key, icon, label, fill, color } of reflectionFields) {
                    const text: string = (reflections as any)[key]?.trim();
                    if (!text) continue;

                    docSections.push(new Paragraph({
                      children: [new TextRun({ text: `${icon}  ${label.toUpperCase()}`, bold: true, size: 20, color, allCaps: false })],
                      shading: { fill },
                      border: borderSpec(color, { top: true }),
                      indent: { left: 240, right: 240 },
                      spacing: { before: 200, after: 0 },
                    }));

                    const lines = text.split('\n').filter((l: string) => l.trim());
                    lines.forEach((line: string, li: number) => {
                      docSections.push(new Paragraph({
                        children: [new TextRun({ text: line, size: 21, color: '1F2937' })],
                        shading: { fill },
                        border: borderSpec(color, { bottom: li === lines.length - 1 }),
                        indent: { left: 240, right: 240 },
                        spacing: { before: 30, after: 0 },
                      }));
                    });
                  }

                  docSections.push(new Paragraph({ spacing: { after: 240 } }));

                } else {
                  // ── Regular entry ──────────────────────────────────────────────────
                  if (entry.opponentLastMove) {
                    docSections.push(
                      new Paragraph({
                        children: [
                          new TextRun({ text: `Opponent's last move: `, bold: true }),
                          new TextRun({ text: entry.opponentLastMove }),
                        ],
                        spacing: { before: 100, after: 60 }
                      })
                    );
                  }

                  // For game entries the timestamp is already on the "Game:" header line
                  // above the diagram; only prepend it here for general (non-game) entries.
                  const contentChildren = entry.gameId
                    ? [new TextRun({ text: entry.content })]
                    : [new TextRun({ text: `[${timestamp}] `, italics: true }), new TextRun({ text: entry.content })];
                  docSections.push(
                    new Paragraph({
                      children: contentChildren,
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

                // Add additional user-uploaded images (if any beyond the first board image)
                // Skip first image only if we actually used it as a board diagram above
                // Not applicable to post-game summaries
                const entryImages =
                  entry.entryType !== 'post_game_summary' && entry.images && entry.images.length > 0
                    ? (usedFirstImageAsBoard ? entry.images.slice(1) : entry.images)
                    : [];

                if (entryImages.length > 0) {
                  try {
                    for (const [index, img] of entryImages.entries()) {
                      // Remove data URL prefix
                      const base64Data = img.split(',')[1] || img;
                      const imageBuffer = Buffer.from(base64Data, 'base64');

                      // Detect image dimensions to maintain aspect ratio
                      let width = 400;
                      let height = 300;
                      try {
                        if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) {
                          // PNG — dimensions at bytes 16-23
                          width = imageBuffer.readUInt32BE(16);
                          height = imageBuffer.readUInt32BE(20);
                        } else if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8) {
                          // JPEG — scan for SOF0/SOF2 marker (0xFFC0 or 0xFFC2)
                          let offset = 2;
                          while (offset < imageBuffer.length - 8) {
                            if (imageBuffer[offset] !== 0xFF) break;
                            const marker = imageBuffer[offset + 1];
                            const segLen = imageBuffer.readUInt16BE(offset + 2);
                            if (marker === 0xC0 || marker === 0xC2) {
                              height = imageBuffer.readUInt16BE(offset + 5);
                              width = imageBuffer.readUInt16BE(offset + 7);
                              break;
                            }
                            offset += 2 + segLen;
                          }
                        }
                        // Scale to max width of 500 while maintaining aspect ratio
                        const maxWidth = 500;
                        if (width > maxWidth) {
                          const scale = maxWidth / width;
                          height = Math.round(height * scale);
                          width = maxWidth;
                        }
                      } catch (e) {
                        // Fall back to defaults set above
                      }

                      try {
                        docSections.push(
                          new Paragraph({
                            children: [
                              new ImageRun({
                                data: imageBuffer,
                                transformation: {
                                  width: width,
                                  height: height,
                                },
                                type: 'png',
                              }),
                            ],
                            spacing: { after: entryImages.length > 1 ? 100 : 200 }
                          })
                        );
                      } catch (imgError: any) {
                        console.error(`[EXPORT] Failed to add user image ${index + 1}:`, imgError.message);
                      }
                    }
                  } catch (error) {
                    console.error('[EXPORT] Error adding images to document:', error);
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

                // Add AI review and post-review only for regular entries (not post-game summaries).
                // AI review is shown first, then the user's own post-game review.

                // Add AI review if present and enabled (not for post-game summaries)
                if (includePostReviews && entry.aiReview && entry.entryType !== 'post_game_summary') {
                  // Add spacing before review
                  docSections.push(new Paragraph({ spacing: { before: 200 } }));

                  // Add AI review with cyan shading
                  docSections.push(
                    new Paragraph({
                      children: [
                        new TextRun({ text: '🤖 AI ANALYSIS', bold: true, color: '0E7490', size: 24 })
                      ],
                      shading: { fill: 'CFFAFE' },
                      indent: { left: 720 },
                      spacing: { after: 50 }
                    })
                  );

                  // Add model info
                  const modelName = entry.aiReview.model
                    ? entry.aiReview.model.replace('claude-', '').replace(/-/g, ' ')
                    : 'AI';
                  docSections.push(
                    new Paragraph({
                      children: [
                        new TextRun({ text: `Model: ${modelName}`, italics: true, color: '0E7490', size: 20 })
                      ],
                      shading: { fill: 'CFFAFE' },
                      indent: { left: 720 },
                      spacing: { after: 100 }
                    })
                  );

                  // Split AI review content by newlines and create separate paragraphs
                  const aiParagraphs = entry.aiReview.content.split('\n').filter((p: string) => p.trim());
                  for (let i = 0; i < aiParagraphs.length; i++) {
                    const paragraph = aiParagraphs[i];
                    docSections.push(
                      new Paragraph({
                        children: [
                          new TextRun({ text: paragraph.trim(), color: '1F2937' })
                        ],
                        shading: { fill: 'CFFAFE' },
                        indent: { left: 720 },
                        spacing: { after: i === aiParagraphs.length - 1 ? 200 : 100 }
                      })
                    );
                  }
                }

                // Add post-review after AI review (not for post-game summaries)
                if (includePostReviews && entry.postReview && entry.entryType !== 'post_game_summary') {
                  const reviewDate = new Date(entry.postReview.timestamp);
                  const entryDate = new Date(entry.timestamp);
                  const daysDiff = Math.floor((reviewDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
                  const timeLabel =
                    daysDiff === 0 ? 'same day' :
                    daysDiff === 1 ? '1 day after game' :
                    `${daysDiff} days after game`;

                  docSections.push(new Paragraph({ spacing: { before: 200 } }));

                  docSections.push(
                    new Paragraph({
                      children: [
                        new TextRun({ text: '📝 POST-GAME REVIEW', bold: true, color: '92400E', size: 24 })
                      ],
                      shading: { fill: 'FEF3C7' },
                      indent: { left: 720 },
                      spacing: { after: 50 }
                    })
                  );
                  docSections.push(
                    new Paragraph({
                      children: [
                        new TextRun({ text: `Added ${timeLabel}`, italics: true, color: '92400E', size: 20 })
                      ],
                      shading: { fill: 'FEF3C7' },
                      indent: { left: 720 },
                      spacing: { after: 100 }
                    })
                  );
                  docSections.push(
                    new Paragraph({
                      children: [
                        new TextRun({ text: entry.postReview.content, italics: true, color: '1F2937' })
                      ],
                      shading: { fill: 'FEF3C7' },
                      indent: { left: 720 },
                      spacing: { after: 200 }
                    })
                  );
                }

                current++;
                send({ type: 'progress', current, total: totalEntries });
              }
            }

            // Persist only the entries that actually got a newly-cached board
            // image, instead of rewriting the entire journal on every export.
            if (entriesToPersist.size > 0) {
              try {
                await Promise.all(
                  Array.from(entriesToPersist.values()).map(e => saveJournalEntry(e))
                );
                console.log(`[EXPORT] Cached ${entriesToPersist.size} board image(s) back to journal`);
              } catch (saveError) {
                // Silently continue - export still works, images just won't be cached
                console.warn('[EXPORT] Could not cache images:', saveError instanceof Error ? saveError.message : String(saveError));
              }
            }

            const doc = new Document({
              sections: [{ children: docSections }]
            });
            const buffer = await Packer.toBuffer(doc);
            const base64 = Buffer.from(buffer).toString('base64');
            const filename = `chess-journal-${startDate}-to-${endDate}.docx`;

            send({ type: 'done', filename, data: base64 });
          } catch (error) {
            console.error('[EXPORT] Stream error:', error);
            send({ type: 'error', message: error instanceof Error ? error.message : 'Export failed' });
          } finally {
            controller.close();
          }
        }
      });

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
        }
      });
    }

    // Return JSON for client-side text export
    return NextResponse.json({
      entries: entries.map(entry => ({
        ...entry,
        game: entry.gameId ? games[entry.gameId] : null
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
