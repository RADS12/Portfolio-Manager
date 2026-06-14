import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Routes } from '@angular/router';
import { authInterceptor } from './core/http/auth.interceptor';

const routes: Routes = [
  // Shell wraps all views — no login required
  {
    path: '',
    loadComponent: () => import('./shell/shell.component').then(m => m.ShellComponent),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' as const },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
      },
      {
        path: 'holdings',
        loadComponent: () => import('./features/holdings/holdings.component').then(m => m.HoldingsComponent),
      },
      {
        path: 'drilldown',
        loadComponent: () => import('./features/drilldown/drilldown.component').then(m => m.DrilldownComponent),
      },
      {
        path: 'exposure',
        loadComponent: () => import('./features/exposure/exposure.component').then(m => m.ExposureComponent),
      },
      {
        path: 'risk',
        loadComponent: () => import('./features/risk/risk.component').then(m => m.RiskComponent),
      },
      {
        path: 'charts',
        loadComponent: () => import('./features/charts/charts.component').then(m => m.ChartsComponent),
      },
      {
        path: 'onboarding',
        loadComponent: () => import('./features/onboarding/onboarding.component').then(m => m.OnboardingComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings.component').then(m => m.SettingsComponent),
      },
    ],
  },

  // Catch-all — redirect everything (including /login) to dashboard
  { path: '**', redirectTo: 'dashboard' },
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
