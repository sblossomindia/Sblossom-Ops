/**
 * Module augmentation for NextAuth v5. Adds `id` and `role` to the session
 * user and JWT token so callers don't have to cast everywhere.
 *
 * Picked up via tsconfig `include`; no explicit import needed by consumers.
 */
import type { DefaultSession } from 'next-auth';
import type { DefaultJWT } from 'next-auth/jwt';

export type UserRoleValue = 'production' | 'qc' | 'shipment' | 'admin';

declare module 'next-auth' {
  interface User {
    role: UserRoleValue;
  }

  interface Session {
    user: {
      id: string;
      role: UserRoleValue;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string;
    role: UserRoleValue;
  }
}
