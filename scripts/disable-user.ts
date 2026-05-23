/**
 * Disable an employee user (sets is_active = false).
 *
 *   pnpm tsx scripts/disable-user.ts <email>
 *
 * Idempotent — running on an already-disabled user prints a notice and
 * exits 0. To re-enable, use Drizzle Studio or SQL.
 */
import { loadEnvConfig } from '@next/env';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { closePrompts, confirm } from './_prompts';

loadEnvConfig(process.cwd());

async function main() {
  const rawArg = process.argv[2];
  if (!rawArg) {
    console.error('Usage: pnpm tsx scripts/disable-user.ts <email>');
    process.exit(1);
  }

  const emailParse = z.string().trim().toLowerCase().email().safeParse(rawArg);
  if (!emailParse.success) {
    console.error(`✗ Not a valid email: ${rawArg}`);
    process.exit(1);
  }
  const email = emailParse.data;

  const { db, users, closeDb } = await import('../lib/db');

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    console.error(`✗ No user found with email ${email}.`);
    closePrompts();
    await closeDb();
    process.exitCode = 1;
    return;
  }

  if (!user.isActive) {
    console.log(`User ${user.email} is already disabled. No change.`);
    closePrompts();
    await closeDb();
    return;
  }

  console.log('User:');
  console.log(`  email: ${user.email}`);
  console.log(`  name:  ${user.name}`);
  console.log(`  role:  ${user.role}`);

  if (!(await confirm('Disable this user?'))) {
    console.log('Aborted.');
    closePrompts();
    await closeDb();
    return;
  }

  await db
    .update(users)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  console.log(`\n✓ Disabled ${user.email}. They will be unable to log in.`);
  closePrompts();
  await closeDb();
}

main().catch(async (err) => {
  console.error('disable-user failed:', err);
  closePrompts();
  try {
    const { closeDb } = await import('../lib/db');
    await closeDb();
  } catch {
    /* db may not have been imported */
  }
  process.exitCode = 1;
});
