const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');

// Read journal data from stdin
let inputData = '';
process.stdin.on('data', chunk => inputData += chunk);
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(inputData);
    const { groupedByDate, username } = data;

    const sections = [{
      properties: {
        page: {
          size: {
            width: 12240,   // 8.5 inches
            height: 15840   // 11 inches
          },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: []
    }];

    // Title
    sections[0].children.push(
      new Paragraph({
        text: "Chess Journal",
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      })
    );

    // Process each day
    groupedByDate.forEach((day, dayIndex) => {
      // Date heading
      const dateObj = new Date(day.date);
      const formattedDate = dateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      sections[0].children.push(
        new Paragraph({
          text: formattedDate,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 }
        })
      );

      // Process entries for this day
      day.entries.forEach((entry, entryIndex) => {

        // ── POST-GAME SUMMARY ────────────────────────────────────────────────
        if (entry.entryType === 'post_game_summary') {
          const pg = entry.postGameSummary;
          const snap = entry.gameSnapshot;

          // Section header
          const headerParts = [new TextRun({ text: '\uD83C\uDFC1 Post-Game Summary', bold: true, size: 26 })];
          if (snap) {
            const resultLabel = snap.result
              ? '  \u00B7  ' + snap.result.charAt(0).toUpperCase() + snap.result.slice(1)
              : '';
            headerParts.push(new TextRun({ text: `  vs. ${snap.opponent}${resultLabel}`, size: 24 }));
          }
          sections[0].children.push(
            new Paragraph({ children: headerParts, spacing: { before: 200, after: 100 } })
          );

          // Statistics line
          if (pg?.statistics) {
            const s = pg.statistics;
            const parts = [];
            if (s.accuracy != null)             parts.push(`Accuracy: ${s.accuracy}%`);
            if (s.totalMoves)                   parts.push(`Moves: ${s.totalMoves}`);
            if (s.blunders != null)             parts.push(`Blunders: ${s.blunders}`);
            if (s.mistakes != null)             parts.push(`Mistakes: ${s.mistakes}`);
            if (s.inaccuracies != null)         parts.push(`Inaccuracies: ${s.inaccuracies}`);
            if (s.averageCentipawnLoss != null)  parts.push(`Avg CP Loss: ${s.averageCentipawnLoss}`);
            if (parts.length) {
              sections[0].children.push(
                new Paragraph({
                  children: [new TextRun({ text: parts.join('  \u00B7  '), size: 20, color: '555555' })],
                  spacing: { after: 120 }
                })
              );
            }
          }

          // Four reflection sections — only write non-empty ones
          const reflections = pg?.reflections || {};
          const fields = [
            { key: 'whatWentWell',   label: 'What Went Well' },
            { key: 'mistakes',       label: 'Key Mistakes' },
            { key: 'lessonsLearned', label: 'Lessons Learned' },
            { key: 'nextSteps',      label: 'Next Steps' },
          ];
          for (const { key, label } of fields) {
            const text = reflections[key]?.trim();
            if (!text) continue;
            sections[0].children.push(
              new Paragraph({
                children: [new TextRun({ text: label, bold: true, size: 22 })],
                spacing: { before: 120, after: 40 }
              })
            );
            // Split on newlines so multi-line reflections render as separate paragraphs
            const textLines = text.split('\n').filter(l => l.trim());
            textLines.forEach((line, li) => {
              sections[0].children.push(
                new Paragraph({
                  children: [new TextRun({ text: line, size: 22 })],
                  spacing: { after: li === textLines.length - 1 ? 120 : 40 }
                })
              );
            });
          }

        } else {
          // ── REGULAR ENTRY ────────────────────────────────────────────────────
          const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          let headerText = timeStr;

          // Add game info if present
          if (entry.game && username) {
            const isWhite = entry.game.white.toLowerCase() === username.toLowerCase();
            const colorEmoji = isWhite ? '\u26AA' : '\u26AB';
            headerText += ` - ${colorEmoji} vs ${entry.game.opponent}`;
            if (entry.fen) {
              const fenParts = entry.fen.split(' ');
              if (fenParts.length >= 6) {
                headerText += ` \u2022 Move ${fenParts[5]}`;
              }
            }
          } else if (!entry.gameId) {
            headerText += ' - General Thoughts';
          }

          // Entry header
          sections[0].children.push(
            new Paragraph({
              children: [new TextRun({ text: headerText, bold: true, size: 22 })],
              spacing: { before: 200, after: 100 }
            })
          );

          // Entry content — split on newlines
          const contentLines = (entry.content || '').split('\n').filter(l => l.trim());
          contentLines.forEach(line => {
            sections[0].children.push(
              new Paragraph({
                children: [new TextRun({ text: line, size: 22 })],
                spacing: { after: 80 }
              })
            );
          });

          // My move
          if (entry.myMove) {
            sections[0].children.push(
              new Paragraph({
                children: [new TextRun({ text: `\u2713 My Move: ${entry.myMove}`, bold: true, color: '228B22', size: 22 })],
                spacing: { after: 100 }
              })
            );
          }

          // AI review — only for regular entries, skipped for post_game_summary
          if (entry.aiReview?.content) {
            sections[0].children.push(
              new Paragraph({
                children: [new TextRun({ text: '\uD83E\uDD16 AI Analysis', bold: true, size: 22, color: '0077AA' })],
                spacing: { before: 120, after: 60 }
              })
            );
            const aiLines = entry.aiReview.content.split('\n').filter(l => l.trim());
            aiLines.forEach(line => {
              sections[0].children.push(
                new Paragraph({
                  children: [new TextRun({ text: line, size: 20, color: '333333' })],
                  spacing: { after: 60 }
                })
              );
            });
          }

          // Post review
          if (entry.postReview?.content) {
            sections[0].children.push(
              new Paragraph({
                children: [new TextRun({ text: '\uD83D\uDCDD Post-Game Review', bold: true, size: 22, color: 'AA7700' })],
                spacing: { before: 120, after: 60 }
              })
            );
            const prLines = entry.postReview.content.split('\n').filter(l => l.trim());
            prLines.forEach(line => {
              sections[0].children.push(
                new Paragraph({
                  children: [new TextRun({ text: line, size: 20, color: '333333' })],
                  spacing: { after: 60 }
                })
              );
            });
          }
        }
        // ── END ENTRY ────────────────────────────────────────────────────────

        // Separator between entries (except last entry of the day)
        if (entryIndex < day.entries.length - 1) {
          sections[0].children.push(
            new Paragraph({
              text: '\u2500'.repeat(50),
              spacing: { before: 120, after: 120 }
            })
          );
        }
      });

      // Extra space between days
      if (dayIndex < groupedByDate.length - 1) {
        sections[0].children.push(
          new Paragraph({ text: '', spacing: { after: 400 } })
        );
      }
    });

    const doc = new Document({ sections });
    const buffer = await Packer.toBuffer(doc);
    process.stdout.write(buffer.toString('base64'));

  } catch (error) {
    console.error('Error generating document:', error);
    process.exit(1);
  }
});
