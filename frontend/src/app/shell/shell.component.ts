import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Portfolio } from '../core/models/portfolio.models';

// Shared service so child components can react when portfolio changes
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ActivePortfolioService {
  private _id = new BehaviorSubject<string>('');
  readonly id$ = this._id.asObservable();
  get id() { return this._id.value; }
  set(id: string) { this._id.next(id); }
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, FormsModule],
  template: `
    <div class="app-shell">
      <!-- ── Sidebar ─────────────────────────────── -->
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-mark">PQ</div>
          <div>
            <div class="brand-name">PortfolioIQ</div>
            <div class="brand-sub">Investment Intelligence</div>
          </div>
        </div>

        <nav class="nav">
          <div class="nav-section">Analytics</div>
          <button class="nav-item" (click)="go('dashboard')" [class.active]="isActive('dashboard')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            Overview
          </button>
          <button class="nav-item" (click)="go('holdings')" [class.active]="isActive('holdings')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>
            All Holdings
          </button>
          <button class="nav-item" (click)="go('drilldown')" [class.active]="isActive('drilldown')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            Drill-Down
          </button>
          <button class="nav-item" (click)="go('exposure')" [class.active]="isActive('exposure')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            True Exposure
          </button>

          <div class="nav-section">Insights</div>
          <button class="nav-item" (click)="go('risk')" [class.active]="isActive('risk')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Risk Insights
          </button>
          <button class="nav-item" (click)="go('charts')" [class.active]="isActive('charts')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Charts
          </button>

          <div class="nav-section">Setup</div>
          <button class="nav-item" (click)="go('onboarding')" [class.active]="isActive('onboarding')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Import CSV
          </button>
        </nav>

        <div class="sidebar-footer">
          <div class="user-pill">
            <div class="user-avatar">PQ</div>
            <div>
              <div class="user-name">Local Dev</div>
              <span class="user-plan">Pro</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- ── Main ────────────────────────────────── -->
      <div class="main-area">
        <header class="topbar">
          <div class="topbar-left">
            <div class="page-eyebrow">Portfolio workspace</div>
            <div class="page-title">{{ pageTitle() }}</div>
          </div>
          <div class="topbar-actions">
            <select class="portfolio-select" [(ngModel)]="selectedPortfolioId"
              (ngModelChange)="onPortfolioChange($event)">
              <option *ngFor="let p of portfolios()" [value]="p.id">{{ p.name }}</option>
            </select>
            <label class="btn" style="cursor:pointer">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload CSV
              <input type="file" accept=".csv" style="display:none" (change)="onFileUpload($event)">
            </label>
            <button class="btn btn-primary" [class.spinning]="refreshing()" (click)="refreshPrices()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              {{ refreshing() ? 'Refreshing...' : 'Refresh Prices' }}
            </button>
          </div>
        </header>

        <!-- Upload banner shown until first CSV is imported -->
        <div *ngIf="showUploadBanner()" style="background:#fefce8;border-bottom:1px solid #fde68a;padding:10px 24px;display:flex;align-items:center;gap:12px;font-size:12px;color:#92400e">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          No portfolio data yet.
          <label style="cursor:pointer;font-weight:600;text-decoration:underline">
            Upload your CSV now
            <input type="file" accept=".csv" style="display:none" (change)="onFileUpload($event)">
          </label>
          to see your dashboard.
        </div>

        <div class="page-content">
          <router-outlet />
        </div>
      </div>
    </div>
  `
})
export class ShellComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private activePortfolio = inject(ActivePortfolioService);

  portfolios = signal<Portfolio[]>([]);
  selectedPortfolioId = '';
  refreshing = signal(false);
  showUploadBanner = signal(false);

  private readonly PAGE_TITLES: Record<string, string> = {
    dashboard: 'Executive Overview', holdings: 'All Holdings',
    drilldown: 'Drill-Down Analysis', exposure: 'True Exposure',
    risk: 'Risk Insights', charts: 'Charts',
    onboarding: 'Import Portfolio', settings: 'Settings',
  };

  pageTitle = computed(() => {
    const seg = this.router.url.split('/')[1]?.split('?')[0] ?? 'dashboard';
    return this.PAGE_TITLES[seg] ?? 'PortfolioIQ';
  });

  isActive(route: string): boolean {
    return this.router.url.startsWith('/' + route);
  }

  go(route: string): void {
    this.router.navigate(['/' + route]);
  }

  ngOnInit(): void {
    this.loadPortfolios();
  }

  loadPortfolios(): void {
    this.http.get<Portfolio[]>(`${environment.apiUrl}/portfolios`).subscribe({
      next: portfolios => {
        if (portfolios.length === 0) {
          // No portfolio yet — create one then tell all children
          this.http.post<Portfolio>(`${environment.apiUrl}/portfolios`,
            { name: 'My Portfolio', currency: 'USD' })
            .subscribe(p => {
              this.portfolios.set([p]);
              this.selectedPortfolioId = p.id;
              this.activePortfolio.set(p.id);
              this.showUploadBanner.set(true);
            });
        } else {
          this.portfolios.set(portfolios);
          this.selectedPortfolioId = portfolios[0].id;
          this.activePortfolio.set(portfolios[0].id);
        }
      },
      error: (e) => console.warn('API unreachable:', e.message)
    });
  }

  onPortfolioChange(id: string): void {
    this.selectedPortfolioId = id;
    this.activePortfolio.set(id);
  }

  onFileUpload(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.selectedPortfolioId) return;
    const form = new FormData();
    form.append('file', file);
    this.http.post<any>(`${environment.apiUrl}/portfolios/${this.selectedPortfolioId}/upload`, form)
      .subscribe({
        next: res => {
          this.showUploadBanner.set(false);
          alert('✓ Imported ' + res.position_count + ' positions');
          this.activePortfolio.set(this.selectedPortfolioId); // re-emit to trigger reload
          this.go('dashboard');
        },
        error: (e) => alert('Upload failed: ' + (e?.error?.detail ?? e.message))
      });
  }

  refreshPrices(): void {
    if (!this.selectedPortfolioId || this.refreshing()) return;
    this.refreshing.set(true);
    setTimeout(() => this.refreshing.set(false), 3000);
  }
}
