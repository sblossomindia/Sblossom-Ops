import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '@/lib/env';
import * as schema from './schema';

if (!env.DATABASE_URL) {
  throw new Error('lib/db: DATABASE_URL is required but missing from env');
}

// Supabase pgbouncer (port 6543, transaction mode) doesn't support PREPARE.
// `prepare: false` makes postgres-js use the simple query protocol.
const client = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 10,
});

export const db = drizzle(client, { schema });
export type Db = typeof db;

/**
 * Close the underlying connection. Call this from CLI scripts so the
 * event loop drains and Node exits naturally — saves the script from
 * `process.exit(0)`, which races stdout flushing.
 */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}

export * from './schema';
