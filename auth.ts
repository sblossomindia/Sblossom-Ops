/**
 * Full NextAuth instance used by the API route + server actions. Runs on the
 * Node runtime, so importing the DB client + bcrypt is fine here.
 *
 * Lockout policy (SPEC §9):
 *   - 5 consecutive wrong passwords → 15 minute lockout
 *   - Lockout cleared on successful login or admin password reset
 *   - Disabled (is_active = false) users always fail
 */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

import { authConfig } from '@/auth.config';
import { db, users } from '@/lib/db';

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(rawCredentials) {
        const parse = credentialsSchema.safeParse(rawCredentials);
        if (!parse.success) return null;
        const { email, password } = parse.data;

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) return null;
        if (!user.isActive) return null;

        // Lockout check — short-circuit before bcrypt to avoid revealing
        // anything via timing.
        if (user.lockoutUntil && user.lockoutUntil > new Date()) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          const nextAttempts = user.failedLoginAttempts + 1;
          const nextLockout =
            nextAttempts >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;
          await db
            .update(users)
            .set({
              failedLoginAttempts: nextAttempts,
              lockoutUntil: nextLockout,
              updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));
          return null;
        }

        // Success: clear counters, stamp login.
        await db
          .update(users)
          .set({
            failedLoginAttempts: 0,
            lockoutUntil: null,
            lastLoginAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
});
