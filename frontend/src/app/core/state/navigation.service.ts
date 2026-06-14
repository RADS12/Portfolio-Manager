// src/app/core/state/navigation.service.ts
// ──────────────────────────────────────────
// Shared service for passing drill-down context between pages.
// When user clicks "Information Technology" on dashboard → navigates
// to drilldown with sector=Information Technology pre-selected.

import { Injectable, signal } from '@angular/core';

export type DrillLens = 'sector' | 'theme' | 'risk_bucket' | 'asset_type' | 'region';

export interface DrillContext {
  lens: DrillLens;
  group: string;
}

@Injectable({ providedIn: 'root' })
export class NavigationStateService {
  private _drillContext = signal<DrillContext | null>(null);

  readonly drillContext = this._drillContext.asReadonly();

  navigateToDrill(lens: DrillLens, group: string): DrillContext {
    const ctx = { lens, group };
    this._drillContext.set(ctx);
    return ctx;
  }

  clearDrill(): void {
    this._drillContext.set(null);
  }
}
