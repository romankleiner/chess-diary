import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'chess-diary-data.json');

interface DatabaseData {
  games: Record<string, any>;
  journal_entries: any[];
  move_analysis: any[];
  settings: Record<string, string>;
}

let dbCache: DatabaseData | null = null;

// Initialize or load database
export function getDb(): DatabaseData {
  if (dbCache) return dbCache;

  if (existsSync(dataPath)) {
    const data = readFileSync(dataPath, 'utf-8');
    dbCache = JSON.parse(data);
  } else {
    dbCache = {
      games: {},
      journal_entries: [],
      move_analysis: [],
      settings: {}
    };
    saveDb(dbCache);
  }
  
  return dbCache;
}

export function saveDb(data: DatabaseData) {
  writeFileSync(dataPath, JSON.stringify(data, null, 2));
  dbCache = data;
}

export default getDb;
