/**
 * Applies migrations using the DIRECT_URL (port 5432, non-pooled).
 *
 * pgbouncer (port 6543) in transaction-pooling mode doesn't safely handle
 * advisory locks, DDL transactions, or PREPAREs the way drizzle's migrator
 * needs. Always run migrations against the direct connection.
 */
import { loadEnvConfig } from '@next/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

loadEnvConfig(process.cwd());

const url = process.env.DIRECT_URL;
if (!url) {
  console.error('DIRECT_URL is required (must be the non-pooled Supabase URL on port 5432).');
  process.exit(1);
}

async function main() {
  const client = postgres(url!, { max: 1 });
  const db = drizzle(client);

  console.log('Running migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');

  await client.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
