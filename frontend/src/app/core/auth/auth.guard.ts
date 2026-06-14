// src/app/core/auth/auth.guard.ts
// ─────────────────────────────────
// Protects routes that require login.
// If the user is not authenticated, redirects to /login.

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/login']);
};

// Pro plan guard — redirect to /settings/billing if not on Pro
export const proGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isPro()) {
    return true;
  }
  return router.createUrlTree(['/settings'], {
    queryParams: { upgrade: 'true' },
  });
};
