/**
 * File-backed KVNamespace-compatible store for Docker/Express deployments.
 * Writes to a JSON file on the mounted /app/data volume — survives container restarts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

interface Entry {
  v: string;
  exp: number; // absolute timestamp in ms, 0 = no expiry
}

export class FileKV {
  private _data: Map<string, Entry>;
  private _path: string;
  private _dirty = false;

  constructor(filePath: string) {
    this._path = filePath;
    this._data = this._load();
    // Periodic flush every 30s
    setInterval(() => this._flush(), 30_000);
  }

  private _load(): Map<string, Entry> {
    try {
      if (existsSync(this._path)) {
        const raw = JSON.parse(readFileSync(this._path, 'utf-8'));
        if (raw && typeof raw === 'object') {
          return new Map(Object.entries(raw));
        }
      }
    } catch { /* corrupt file, start fresh */ }
    return new Map();
  }

  private _persist() {
    const dir = dirname(this._path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const obj: Record<string, Entry> = {};
    for (const [k, entry] of this._data) {
      obj[k] = entry;
    }
    writeFileSync(this._path, JSON.stringify(obj));
  }

  private _flush() {
    if (this._dirty) {
      this._persist();
      this._dirty = false;
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this._data.get(key);
    if (!entry) return null;
    // Check TTL
    if (entry.exp > 0 && Date.now() > entry.exp) {
      this._data.delete(key);
      this._dirty = true;
      return null;
    }
    return entry.v;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const exp = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : 0;
    this._data.set(key, { v: value, exp });
    this._dirty = true;
  }

  async delete(key: string): Promise<void> {
    if (this._data.delete(key)) {
      this._dirty = true;
    }
  }
}
