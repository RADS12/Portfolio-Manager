import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Summary, Position } from '../../core/models/portfolio.models';
import { ActivePortfolioService } from '../../shell/shell.component';
import { NavigationStateService } from '../../core/state/navigation.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DecimalPipe],
  template: `
    <div class="loading-wrap" *ngIf="loading()"><div class="spinner"></div></div>

    <div class="empty-state" *ngIf="!loading() && !summary()">
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.2" style="margin:0 auto 16px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <h3>No portfolio data yet</h3>
      <p style="margin-bottom:20px">Use <strong>Upload CSV</strong> in the topbar to import your positions</p>
    </div>

    <ng-container *ngIf="!loading() && summary() as s">

      <div class="status-bar">
        <span class="status-dot"></span>
        <span>{{ s.position_count }} positions</span>
        <span class="status-sep">·</span>
        <span>{{ s.market_data.pricing_mode }}</span>
        <span class="status-sep">·</span>
        <span style="color:#10b981;font-weight:600">{{ s.market_data.live_priced_positions }} live-priced</span>
      </div>

      <!-- KPIs -->
      <div class="kpi-grid">
        <div class="kpi-card accent">
          <div class="kpi-label">Total Portfolio Value</div>
          <div class="kpi-value">{{ s.total_value | currency:'USD':'symbol':'1.0-0' }}</div>
          <div class="kpi-sub">{{ s.position_count }} unique holdings</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Cash Position</div>
          <div class="kpi-value">{{ s.cash_weight | number:'1.1-1' }}%</div>
          <div class="kpi-sub">{{ s.cash_value | currency:'USD':'symbol':'1.0-0' }}</div>
          <span class="badge badge-purple">Defensive</span>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Top 10 Concentration</div>
          <div class="kpi-value">{{ s.top10_weight | number:'1.1-1' }}%</div>
          <div class="kpi-sub">{{ s.top10_value | currency:'USD':'symbol':'1.0-0' }}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Largest Holding</div>
          <div class="kpi-value">{{ s.largest_holding?.symbol ?? '—' }}</div>
          <div class="kpi-sub">{{ s.largest_holding?.weight | number:'1.1-1' }}% · {{ s.largest_holding?.name }}</div>
        </div>
      </div>

      <div class="two-col">
        <!-- Sector — click navigates to drilldown -->
        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="panel-title">Sector Allocation</div>
              <div class="panel-sub">Click any sector to drill in</div>
            </div>
            <span class="panel-link" (click)="drillTo('sector','All')">View all →</span>
          </div>
          <div class="panel-body">
            <div class="alloc-row" *ngFor="let item of s.sector_allocation.slice(0,8)"
              (click)="drillTo('sector', item.name)">
              <span class="alloc-name">{{ item.name }}</span>
              <div class="alloc-track"><div class="alloc-fill fill-purple" [style.width.%]="item.weight"></div></div>
              <span class="alloc-pct">{{ item.weight | number:'1.1-1' }}%</span>
              <span style="font-size:11px;color:#8b5cf6;opacity:0.7">→</span>
            </div>
          </div>
        </div>

        <div>
          <!-- Theme — click navigates to drilldown -->
          <div class="panel">
            <div class="panel-header">
              <div class="panel-title">Theme Exposure</div>
              <span class="panel-link" (click)="drillTo('theme','All')">View all →</span>
            </div>
            <div class="panel-body">
              <div class="alloc-row" *ngFor="let item of s.theme_allocation.slice(0,6)"
                (click)="drillTo('theme', item.name)">
                <span class="alloc-name">{{ item.name }}</span>
                <div class="alloc-track"><div class="alloc-fill fill-teal" [style.width.%]="item.weight"></div></div>
                <span class="alloc-pct">{{ item.weight | number:'1.1-1' }}%</span>
                <span style="font-size:11px;color:#0d9488;opacity:0.7">→</span>
              </div>
            </div>
          </div>

          <!-- Risk — click navigates to drilldown -->
          <div class="panel">
            <div class="panel-header">
              <div class="panel-title">Risk Profile</div>
              <span class="panel-link" (click)="drillTo('risk_bucket','All')">View all →</span>
            </div>
            <div class="panel-body">
              <div class="risk-row clickable" *ngFor="let item of s.risk_allocation"
                (click)="drillTo('risk_bucket', item.name)">
                <span class="risk-dot" [ngClass]="riskDot(item.name)"></span>
                <span class="risk-name">{{ item.name }}</span>
                <span class="risk-pct">{{ item.weight | number:'1.1-1' }}%</span>
                <span style="font-size:11px;color:#6b7280;opacity:0.7">→</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="three-col">
        <!-- Asset types -->
        <div class="panel">
          <div class="panel-header"><div class="panel-title">Asset Types</div></div>
          <div class="panel-body">
            <div class="alloc-row clickable" *ngFor="let item of s.asset_type_allocation"
              (click)="drillTo('asset_type', item.name)">
              <span class="alloc-name">{{ item.name }} <span style="color:#9ca3af;font-size:11px">({{ item.count }})</span></span>
              <div class="alloc-track"><div class="alloc-fill fill-blue" [style.width.%]="item.weight"></div></div>
              <span class="alloc-pct">{{ item.weight | number:'1.1-1' }}%</span>
            </div>
          </div>
        </div>

        <!-- Region -->
        <div class="panel">
          <div class="panel-header"><div class="panel-title">Region</div></div>
          <div class="panel-body">
            <div class="alloc-row clickable" *ngFor="let item of s.region_allocation"
              (click)="drillTo('region', item.name)">
              <span class="alloc-name">{{ item.name }}</span>
              <div class="alloc-track"><div class="alloc-fill fill-amber" [style.width.%]="item.weight"></div></div>
              <span class="alloc-pct">{{ item.weight | number:'1.1-1' }}%</span>
            </div>
          </div>
        </div>

        <!-- Top holdings -->
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Top Holdings</div>
            <span class="panel-link" (click)="router.navigate(['/holdings'])">See all →</span>
          </div>
          <div style="padding:4px 0">
            <div *ngFor="let p of positions().slice(0,8); let i = index"
              (click)="router.navigate(['/holdings'])"
              style="display:flex;align-items:center;gap:12px;padding:10px 18px;cursor:pointer;transition:background 0.1s;border-bottom:1px solid #f9fafb"
              onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background=''">
              <div style="width:20px;font-size:11px;color:#9ca3af;text-align:center;font-weight:600">{{ i+1 }}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:800;color:#111827">{{ p.symbol }}</div>
                <div style="font-size:11px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ p.name }}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:13px;font-weight:700;color:#8b5cf6">{{ p.weight | number:'1.2-2' }}%</div>
                <div style="font-size:11px;color:#9ca3af">{{ p.current_value | currency:'USD':'symbol':'1.0-0' }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ng-container>
  `
})
export class DashboardComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private activePortfolio = inject(ActivePortfolioService);
  private navState = inject(NavigationStateService);
  router = inject(Router);

  summary = signal<Summary | null>(null);
  positions = signal<Position[]>([]);
  loading = signal(false);
  private sub!: Subscription;

  riskDot(name: string) {
    if (name.includes('Cash')) return 'dot-green';
    if (name.includes('Core')) return 'dot-blue';
    if (name.includes('High Growth')) return 'dot-amber';
    if (name.includes('Very High')) return 'dot-red';
    return 'dot-gray';
  }

  drillTo(lens: any, group: string) {
    this.navState.navigateToDrill(lens, group);
    this.router.navigate(['/drilldown']);
  }

  ngOnInit() {
    this.sub = this.activePortfolio.id$.pipe(filter(id => !!id))
      .subscribe(id => this.loadData(id));
  }
  ngOnDestroy() { this.sub?.unsubscribe(); }

  loadData(id: string) {
    this.loading.set(true);
    this.http.get<Summary>(`${environment.apiUrl}/portfolios/${id}/summary`)
      .subscribe({ next: s => { this.summary.set(s); this.loading.set(false); }, error: () => this.loading.set(false) });
    this.http.get<Position[]>(`${environment.apiUrl}/portfolios/${id}/positions`)
      .subscribe(p => this.positions.set(p));
  }
}
