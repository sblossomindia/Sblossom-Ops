/**
 * Edge-safe NextAuth config consumed by middleware.ts.
 *
 * Must NOT import bcrypt, postgres-js, drizzle, or anything else that's not
 * Edge-runtime compatible. The Credentials provider's `authorize()` lives in
 * auth.ts and runs on the Node runtime via the API route handler.
 */
import type { NextAuthConfig } from 'next-auth';

import type { UserRoleValue } from '@/types/next-auth';

const PUBLIC_PATHS = ['/login'];
const ADMIN_ROLE_REQUIRED_PREFIXES = ['/admin'];

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours (SPEC §9)
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const role = auth?.user?.role as UserRoleValue | undefined;
      const path = nextUrl.pathname;

      const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));

      if (isPublic) {
        // Already authed? Bounce away from /login.
        if (path === '/login' && isLoggedIn) {
          const callback = nextUrl.searchParams.get('callbackUrl') ?? '/';
          return Response.redirect(new URL(callback, nextUrl));
        }
        return true;
      }

      if (!isLoggedIn) {
        const callback = encodeURIComponent(path + nextUrl.search);
        return Response.redirect(new URL(`/login?callbackUrl=${callback}`, nextUrl));
      }

      // Admin sub-area: /admin/users, /admin/tags, /admin/notifications, etc.
      const requiresAdmin = ADMIN_ROLE_REQUIRED_PREFIXES.some(
        (p) => path === p || path.startsWith(p + '/'),
      );
      if (requiresAdmin && role !== 'admin') {
        return Response.redirect(new URL('/', nextUrl));
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        if (user.id) token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      // typeof narrowing guards against the JWT type's index-signature widening
      // (some `next-auth/jwt` versions widen unaugmented property access).
      if (typeof token.id === 'string') session.user.id = token.id;
      if (typeof token.role === 'string') {
        session.user.role = token.role as UserRoleValue;
      }
      return session;
    },
  },
  providers: [], // Required by NextAuthConfig. auth.ts replaces this (not merges).
} satisfies NextAuthConfig;
