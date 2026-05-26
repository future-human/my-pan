import initSqlJs, { Database as SqlJsDb, SqlJsStatic } from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

let SQL: SqlJsStatic;

async function getSQL(): Promise<SqlJsStatic> {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  password TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0,
  storage_id TEXT NOT NULL DEFAULT 'default'
);
CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at);
`;

class Stmt {
  private _params: unknown[] = [];

  constructor(
    private _db: SqlJsDb,
    private _sql: string,
    private _persist: () => void,
  ) {}

  bind(...params: unknown[]): this {
    this._params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const stmt = this._db.prepare(this._sql);
    stmt.bind(this._params);
    if (stmt.step()) {
      const row = stmt.getAsObject() as T;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  async run(): Promise<{ changes: number }> {
    this._db.run(this._sql, this._params);
    try { this._persist(); } catch (err) { console.error('[db] persist failed after run:', err); }
    return { changes: this._db.getRowsModified() };
  }

  async all<T>(): Promise<{ results: T[] }> {
    const stmt = this._db.prepare(this._sql);
    stmt.bind(this._params);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return { results };
  }

  _exec() {
    this._db.run(this._sql, this._params);
    return { changes: this._db.getRowsModified() };
  }
}

export class DBAdapter {
  private _db!: SqlJsDb;
  private _path!: string;

  static async create(dbPath: string): Promise<DBAdapter> {
    const adapter = new DBAdapter();
    adapter._path = dbPath;
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const S = await getSQL();
    if (existsSync(dbPath)) {
      const buf = readFileSync(dbPath);
      adapter._db = new S.Database(buf);
    } else {
      adapter._db = new S.Database();
    }
    adapter._db.run(SCHEMA);
    return adapter;
  }

  private _persist() {
    const buf = this._db.export();
    writeFileSync(this._path, Buffer.from(buf));
  }

  prepare(sql: string): Stmt {
    return new Stmt(this._db, sql, () => this._persist());
  }

  async batch(stmts: Stmt[]): Promise<{ changes: number }[]> {
    if (stmts.length === 0) return [];
    this._db.run('BEGIN');
    try {
      const results = stmts.map(s => s._exec());
      this._db.run('COMMIT');
      try { this._persist(); } catch (err) { console.error('[db] persist failed after batch:', err); }
      return results;
    } catch (err) {
      this._db.run('ROLLBACK');
      throw err instanceof Error ? err : new Error('batch failed');
    }
  }
}
