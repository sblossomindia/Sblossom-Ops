/**
 * Interactively create an employee user.
 *
 *   pnpm tsx scripts/create-user.ts
 *
 * Prompts for email, name, role, and password. Bcrypt cost 12 (per
 * SPEC §9 and CLAUDE.md hard rule). Fails if the email already exists —
 * use reset-password.ts to change an existing user's password.
 */
import bcrypt from 'bcryptjs';
import { loadEnvConfig } from '@next/env';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { ask, askPassword, askValid, closePrompts, confirm } from './_prompts';

loadEnvConfig(process.cwd());

const ROLES = ['production', 'qc', 'shipment', 'admin'] as const;

async function askEmail(): Promise<string> {
  return askValid('Email: ', (raw) =>
    z.string().trim().toLowerCase().email('Not a valid email').parse(raw),
  );
}

async function askName(): Promise<string> {
  return askValid('Full name: ', (raw) =>
    z.string().trim().min(1, 'Name is required').parse(raw),
  );
}

async function askRole(): Promise<(typeof ROLES)[number]> {
  return askValid(`Role (${ROLES.join('|')}): `, (raw) =>
    z
      .enum(ROLES, { errorMap: () => ({ message: `Must be one of: ${ROLES.join(', ')}` }) })
      .parse(raw.trim().toLowerCase()),
  );
}

async function askPasswordTwice(): Promise<string> {
  while (true) {
    const first = await askPassword('Password (8-72 chars, not echoed): ');
    if (first.length < 8) {
      console.error('  ✗ Too short — minimum 8 characters.');
      continue;
    }
    if (Buffer.byteLength(first, 'utf8') > 72) {
      console.error('  ✗ Too long — bcrypt has a 72-byte limit.');
      continue;
    }
    const second = await askPassword('Confirm password: ');
    if (first !== second) {
      console.error('  ✗ Passwords did not match. Try again.');
      continue;
    }
    return first;
  }
}

async function main() {
  const { db, users, closeDb } = await import('../lib/db');

  console.log('Create a new Sblossom employee user.\n');
  const email = await askEmail();
  const name = await askName();
  const role = await askRole();
  const password = await askPasswordTwice();

  // citext makes the unique constraint case-insensitive but the friendlier
  // message here saves the user from a noisy DB error.
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.error(`\n✗ A user with email ${email} already exists.`);
    console.error('  Use scripts/reset-password.ts to change their password.');
    closePrompts();
    await closeDb();
    process.exitCode = 1;
    return;
  }

  console.log('\nReview:');
  console.log(`  email: ${email}`);
  console.log(`  name:  ${name}`);
  console.log(`  role:  ${role}`);

  if (!(await confirm('Create this user?'))) {
    console.log('Aborted.');
    closePrompts();
    await closeDb();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [created] = await db
    .insert(users)
    .values({ email, name, role, passwordHash })
    .returning({ id: users.id, email: users.email });

  console.log(`\n✓ Created user ${created!.email} (id: ${created!.id})`);
  closePrompts();
  await closeDb();
}

main().catch(async (err) => {
  console.error('create-user failed:', err);
  closePrompts();
  try {
    const { closeDb } = await import('../lib/db');
    await closeDb();
  } catch {
    /* db may not have been imported */
  }
  process.exitCode = 1;
});
