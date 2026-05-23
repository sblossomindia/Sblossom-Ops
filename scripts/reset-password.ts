/**
 * Reset an employee's password.
 *
 *   pnpm tsx scripts/reset-password.ts <email>
 *
 * Also clears failed_login_attempts and lockout_until — resetting the
 * password implies the admin is unlocking the user.
 */
import bcrypt from 'bcryptjs';
import { loadEnvConfig } from '@next/env';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { askPassword, closePrompts, confirm } from './_prompts';

loadEnvConfig(process.cwd());

async function askNewPasswordTwice(): Promise<string> {
  while (true) {
    const first = await askPassword('New password (8-72 chars, not echoed): ');
    if (first.length < 8) {
      console.error('  ✗ Too short — minimum 8 characters.');
      continue;
    }
    if (Buffer.byteLength(first, 'utf8') > 72) {
      console.error('  ✗ Too long — bcrypt has a 72-byte limit.');
      continue;
    }
    const second = await askPassword('Confirm new password: ');
    if (first !== second) {
      console.error('  ✗ Passwords did not match. Try again.');
      continue;
    }
    return first;
  }
}

async function main() {
  const rawArg = process.argv[2];
  if (!rawArg) {
    console.error('Usage: pnpm tsx scripts/reset-password.ts <email>');
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

  console.log('User:');
  console.log(`  email:  ${user.email}`);
  console.log(`  name:   ${user.name}`);
  console.log(`  role:   ${user.role}`);
  console.log(`  active: ${user.isActive}`);
  console.log(
    `  locked: ${user.lockoutUntil ? 'yes, until ' + user.lockoutUntil.toISOString() : 'no'}`,
  );
  console.log(`  failed: ${user.failedLoginAttempts}`);

  if (!(await confirm('Reset this user’s password?'))) {
    console.log('Aborted.');
    closePrompts();
    await closeDb();
    return;
  }

  const password = await askNewPasswordTwice();
  const passwordHash = await bcrypt.hash(password, 12);

  await db
    .update(users)
    .set({
      passwordHash,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  console.log(`\n✓ Password reset for ${user.email}. Lockout (if any) cleared.`);
  closePrompts();
  await closeDb();
}

main().catch(async (err) => {
  console.error('reset-password failed:', err);
  closePrompts();
  try {
    const { closeDb } = await import('../lib/db');
    await closeDb();
  } catch {
    /* db may not have been imported */
  }
  process.exitCode = 1;
});
