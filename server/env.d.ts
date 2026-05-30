// Minimal D1 types — avoids importing @cloudflare/workers-types
// which conflicts with @types/node's Request/Response declarations.
declare interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T extends D1PreparedStatement>(statements: T[]): Promise<D1Result[]>;
}

declare interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T[]>>;
}

declare interface D1Result<T = unknown> {
  results?: T;
  success: boolean;
}

// Minimal KVNamespace interface — satisfied by both Cloudflare KV and FileKV
declare interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
