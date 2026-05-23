'use server';

import { AuthError } from 'next-auth';

import { signIn } from '@/auth';

export type LoginState = { error: string } | undefined;

/**
 * Server action for the login form. Returns a `{ error }` object for failures
 * so the form can render them via `useActionState`. On success, NextAuth's
 * internal redirect throws a NEXT_REDIRECT which Next.js consumes — we must
 * re-throw it (never swallow).
 */
export async function authenticate(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const callbackUrl = (formData.get('callbackUrl') as string | null) || '/';

  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: callbackUrl,
    });
    return undefined;
  } catch (error) {
    if (error instanceof AuthError) {
      // CredentialsSignin covers bad password, missing user, locked, disabled —
      // we deliberately don't distinguish to avoid leaking whether the email exists.
      const message =
        error.type === 'CredentialsSignin'
          ? 'Invalid email, password, or account is locked / disabled.'
          : 'Could not sign in. Try again.';
      return { error: message };
    }
    // NEXT_REDIRECT and other framework errors — let them through.
    throw error;
  }
}
