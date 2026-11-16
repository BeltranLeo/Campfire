// Postgres storage over node-postgres (`pg`), for the Vercel deployment with a Neon database.

import pg from 'pg';
import { PostgresStorage, type SqlQueryExecutor } from './storage.js';

export function createPgStorage(
  connectionString: string,
  options?: { maxConnections?: number },
): { storage: PostgresStorage; close: () => Promise<void> } {
  // A small pool: each serverless instance handles few requests at a time, and the free
  // database tier limits the number of connections.
  const pool = new pg.Pool({ connectionString, max: options?.maxConnections ?? 3 });
  // The server may close idle connections; without a listener that error would crash the function.
  pool.on('error', (err) => {
    console.error('Postgres idle connection error:', err.message);
  });

  const query: SqlQueryExecutor = async (sql, params) => {
    const result = await pool.query(sql, params);
    return { rows: result.rows as Record<string, unknown>[] };
  };

  const storage = new PostgresStorage(query, {
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (sql, params) => {
          const result = await client.query(sql, params);
          return { rows: result.rows as Record<string, unknown>[] };
        },
        release: () => client.release(),
      };
    },
  });

  return { storage, close: () => pool.end() };
}
