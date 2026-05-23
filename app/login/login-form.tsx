'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';

import { authenticate, type LoginState } from './actions';

export function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';

  const [state, dispatch, pending] = useActionState<LoginState, FormData>(
    authenticate,
    undefined,
  );

  return (
    <form action={dispatch} className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          className="rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          minLength={8}
          className="rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      {state?.error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
