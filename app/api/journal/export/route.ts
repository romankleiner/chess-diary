import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

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
    
    const db = getDb();
    
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
      // Generate Word document using docx library via Node script
      const scriptPath = path.join(process.cwd(), 'lib', 'export-journal.js');
      const tmpDir = path.join(process.cwd(), 'tmp');
      const tmpFile = path.join(tmpDir, `export-${Date.now()}.json`);
      
      try {
        // Check if docx is installed
        await execAsync('npm list docx');
      } catch {
        // Install docx if not present
        await execAsync('npm install docx');
      }
      
      // Create tmp directory if it doesn't exist
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      
      // Write data to temp file
      const inputData = JSON.stringify({ groupedByDate: groupedData, username });
      fs.writeFileSync(tmpFile, inputData);
      
      try {
        // Run the script with the temp file
        const { stdout } = await execAsync(`node ${scriptPath} < ${tmpFile}`);
        const buffer = Buffer.from(stdout, 'base64');
        
        // Clean up temp file
        fs.unlinkSync(tmpFile);
        
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="chess-journal-${startDate}-to-${endDate}.docx"`
          }
        });
      } catch (error) {
        // Clean up temp file on error
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
        throw error;
      }
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