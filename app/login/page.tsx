import { Suspense } from 'react';

import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold text-primary">Sblossom Ops</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue.</p>
        </div>
        {/* useSearchParams requires Suspense in App Router. */}
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
