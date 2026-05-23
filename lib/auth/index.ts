/**
 * Server-side auth helpers for use inside Server Components, route handlers,
 * and server actions. The Edge middleware enforces the broad gate; these
 * helpers enforce per-page / per-action role requirements.
 *
 * Usage:
 *   const session = await requireSession();          // throws → redirect to login
 *   const session = await requireRole('admin');      // throws → 403 / redirect
 */
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import type { UserRoleValue } from '@/types/next-auth';

export async function getSession() {
  return auth();
}

export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }
  return session;
}

export async function requireRole(...allowed: UserRoleValue[]) {
  const session = await requireSession();
  if (!allowed.includes(session.user.role)) {
    redirect('/');
  }
  return session;
}
