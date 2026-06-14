// src/app/core/auth/auth.service.ts
// ────────────────────────────────────
// Handles all authentication state and API calls.
// Tokens live in httpOnly cookies — this service never touches them directly.
// It only tracks the current user in a signal for UI purposes.

import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User, TokenResponse } from '../models/portfolio.models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  // ── State ──────────────────────────────────────────────────────────────────
  private _user = signal<User | null>(null);

  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly isPro = computed(() => {
    const plan = this._user()?.plan;
    return plan === 'pro' || plan === 'enterprise';
  });

  // ── Auth API calls ─────────────────────────────────────────────────────────

  register(email: string, password: string): Observable<TokenResponse> {
    return this.http
      .post<TokenResponse>(`${environment.apiUrl}/auth/register`, { email, password })
      .pipe(tap(res => this._user.set(res.user)));
  }

  login(email: string, password: string): Observable<TokenResponse> {
    return this.http
      .post<TokenResponse>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(tap(res => this._user.set(res.user)));
  }

  logout(): void {
    this.http
      .post(`${environment.apiUrl}/auth/logout`, {})
      .subscribe({ complete: () => {
        this._user.set(null);
        this.router.navigate(['/login']);
      }});
  }

  /**
   * Called by the HTTP interceptor when a 401 is received.
   * Exchanges the refresh token cookie for new access + refresh tokens.
   * Returns the new TokenResponse so the interceptor can retry the failed request.
   */
  refresh(): Observable<TokenResponse> {
    return this.http
      .post<TokenResponse>(`${environment.apiUrl}/auth/refresh`, {})
      .pipe(
        tap(res => this._user.set(res.user)),
        catchError(err => {
          // Refresh token is also expired — force re-login
          this._user.set(null);
          this.router.navigate(['/login']);
          return throwError(() => err);
        }),
      );
  }

  /**
   * Load the current user from the API on app startup.
   * If the access token cookie is still valid, this populates the user signal.
   * Called once from APP_INITIALIZER in app.config.ts.
   */
  loadCurrentUser(): Observable<User> {
    return this.http
      .get<User>(`${environment.apiUrl}/auth/me`)
      .pipe(
        tap(user => this._user.set(user)),
        catchError(err => {
          this._user.set(null);
          return throwError(() => err);
        }),
      );
  }
}
