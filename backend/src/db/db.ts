import Database from 'better-sqlite3';
import { ensureDirSync, runtimePaths } from '../config/runtimePaths.js';

const DATA_DIR = runtimePaths.dataDir;
const DB_PATH = runtimePaths.dbPath;

// Ensure data directory exists
ensureDirSync(DATA_DIR);

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
// Foreign keys enforcement
db.pragma('foreign_keys = ON');

export { db, DB_PATH };
