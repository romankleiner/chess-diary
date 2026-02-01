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
        const entryChildren = [];
        
        // Entry header with time
        const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let headerText = timeStr;
        
        // Add game info if present
        if (entry.game && username) {
          const isWhite = entry.game.white.toLowerCase() === username.toLowerCase();
          const colorEmoji = isWhite ? '⚪' : '⚫';
          headerText += ` - ${colorEmoji} vs ${entry.game.opponent}`;
          
          // Add move number if available
          if (entry.fen) {
            const fenParts = entry.fen.split(' ');
            if (fenParts.length >= 6) {
              headerText += ` • Move ${fenParts[5]}`;
            }
          }
        } else if (!entry.gameId) {
          headerText += ' - 💭 General Thoughts';
        }
        
        entryChildren.push(
          new TextRun({
            text: headerText,
            bold: true,
            size: 22
          })
        );
        
        sections[0].children.push(
          new Paragraph({
            children: entryChildren,
            spacing: { before: 200, after: 100 }
          })
        );
        
        // Entry content
        sections[0].children.push(
          new Paragraph({
            text: entry.content,
            spacing: { after: 100 }
          })
        );
        
        // My move if present
        if (entry.myMove) {
          sections[0].children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `✓ My Move: ${entry.myMove}`,
                  bold: true,
                  color: "228B22" // Forest green
                })
              ],
              spacing: { after: 200 }
            })
          );
        }
        
        // Separator between entries (except last entry of the day)
        if (entryIndex < day.entries.length - 1) {
          sections[0].children.push(
            new Paragraph({
              text: "─".repeat(50),
              spacing: { before: 100, after: 100 }
            })
          );
        }
      });
      
      // Extra space between days
      if (dayIndex < groupedByDate.length - 1) {
        sections[0].children.push(
          new Paragraph({ text: "", spacing: { after: 400 } })
        );
      }
    });
    
    const doc = new Document({ sections });
    const buffer = await Packer.toBuffer(doc);
    
    // Write to stdout as base64
    process.stdout.write(buffer.toString('base64'));
    
  } catch (error) {
    console.error('Error generating document:', error);
    process.exit(1);
  }
});