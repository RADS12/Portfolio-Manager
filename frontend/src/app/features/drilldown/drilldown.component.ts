import { Component, inject, OnInit, OnDestroy, signal, computed, effect } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Position } from '../../core/models/portfolio.models';
import { ActivePortfolioService } from '../../shell/shell.component';
import { NavigationStateService, DrillLens } from '../../core/state/navigation.service';

interface TopHolding { symbol: string; name: string; weight: number; source: string; }

@Component({
  selector: 'app-drilldown',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DecimalPipe],
  template: `
    <div class="loading-wrap" *ngIf="loading()"><div class="spinner"></div></div>

    <ng-container *ngIf="!loading() && positions().length > 0">
      <!-- Hero bar -->
      <div style="background:#fff;border:1.5px solid #e5e7eb;border-radius:14px;padding:18px 24px;margin-bottom:22px;display:flex;align-items:center;gap:24px;flex-wrap:wrap">
        <div>
          <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">{{ lensLabel() }}</div>
          <div style="font-size:22px;font-weight:800;color:#111827;margin-top:3px;letter-spacing:-0.5px">
            {{ selectedGroup() === 'All' ? 'Full Portfolio' : selectedGroup() }}
          </div>
        </div>
        <div style="display:flex;gap:24px;margin-left:auto;flex-wrap:wrap">
          <div style="text-align:center">
            <div style="font-size:11px;color:#9ca3af;font-weight:500">Holdings</div>
            <div style="font-size:20px;font-weight:800;color:#111827">{{ selectedGroupPositions().length }}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:11px;color:#9ca3af;font-weight:500">Value</div>
            <div style="font-size:20px;font-weight:800;color:#111827">{{ selectedGroupValue() | currency:'USD':'symbol':'1.0-0' }}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:11px;color:#9ca3af;font-weight:500">Weight</div>
            <div style="font-size:20px;font-weight:800;color:#8b5cf6">{{ selectedGroupWeight() | number:'1.1-1' }}%</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:12px;color:#6b7280;font-weight:500">Lens</label>
          <select class="filter-select" [(ngModel)]="activeLens" (ngModelChange)="onLensChange($event)">
            <option value="sector">Sector</option>
            <option value="theme">Theme</option>
            <option value="risk_bucket">Risk</option>
            <option value="asset_type">Asset Type</option>
            <option value="region">Region</option>
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:250px 1fr;gap:18px">
        <!-- Group list -->
        <div class="panel" style="height:fit-content">
          <div class="panel-header"><div class="panel-title">{{ lensLabel() }}</div></div>
          <div style="padding:4px 0">
            <button *ngFor="let g of groupedRows()"
              (click)="selectedGroup.set(g.name); selectedPosition.set(null)"
              style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:11px 18px;background:none;border:none;border-left:2px solid transparent;cursor:pointer;transition:all 0.12s;text-align:left"
              [style.background]="selectedGroup()===g.name?'rgba(139,92,246,0.07)':''"
              [style.border-left-color]="selectedGroup()===g.name?'#8b5cf6':'transparent'">
              <div>
                <div style="font-size:13px;font-weight:600;color:#111827">{{ g.name }}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:1px">{{ g.count }} holdings</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:13px;font-weight:700;color:#8b5cf6">{{ g.weight | number:'1.1-1' }}%</div>
                <div style="font-size:11px;color:#9ca3af">{{ g.value | currency:'USD':'symbol':'1.0-0' }}</div>
              </div>
            </button>
          </div>
        </div>

        <div>
          <!-- Holdings table -->
          <div class="panel" style="margin-bottom:18px">
            <div class="panel-header">
              <div>
                <div class="panel-title">Holdings in {{ selectedGroup() === 'All' ? 'Full Portfolio' : selectedGroup() }}</div>
                <div class="panel-sub">Click ETF/Fund to see top holdings · Click stock to view details</div>
              </div>
              <div class="search-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input class="search-input" [(ngModel)]="search" placeholder="Search…" style="width:170px">
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th><th>Name</th><th>Type</th>
                    <th *ngIf="activeLens!=='sector'">Sector</th>
                    <th *ngIf="activeLens!=='theme'">Theme</th>
                    <th class="td-right">Value</th>
                    <th class="td-right">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let p of filteredGroupPositions()" (click)="onPositionClick(p)"
                    [style.background]="selectedPosition()?.symbol===p.symbol?'#f5f3ff':''">
                    <td class="td-symbol">{{ p.symbol }}</td>
                    <td class="td-name">{{ p.name }}</td>
                    <td><span class="type-badge" [ngClass]="typeBadge(p.asset_type)">{{ p.asset_type }}</span></td>
                    <td *ngIf="activeLens!=='sector'" style="font-size:12px;color:#6b7280">{{ p.sector }}</td>
                    <td *ngIf="activeLens!=='theme'" style="font-size:12px;color:#6b7280">{{ p.theme }}</td>
                    <td class="td-right" style="font-size:13px;font-weight:700">{{ p.current_value | currency:'USD':'symbol':'1.0-0' }}</td>
                    <td class="td-right">
                      <div class="weight-wrap">
                        <span style="font-size:13px;font-weight:700">{{ p.weight | number:'1.2-2' }}%</span>
                        <div class="weight-track"><div class="weight-fill" [style.width.%]="weightPct(p.weight)"></div></div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Position detail panel -->
          <div class="panel" *ngIf="selectedPosition() as pos">
            <div class="panel-header">
              <div style="display:flex;align-items:center;gap:14px">
                <div>
                  <div style="font-size:22px;font-weight:800;color:#111827;letter-spacing:-0.5px">{{ pos.symbol }}</div>
                  <div style="font-size:13px;color:#6b7280;margin-top:1px">{{ pos.name }}</div>
                </div>
                <span class="type-badge" [ngClass]="typeBadge(pos.asset_type)" style="font-size:12px;padding:4px 12px">{{ pos.asset_type }}</span>
              </div>
              <button (click)="selectedPosition.set(null); topHoldings.set([])"
                style="background:#f3f4f6;border:none;cursor:pointer;font-size:14px;color:#6b7280;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center">✕</button>
            </div>
            <div class="panel-body">
              <!-- Stats row -->
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">
                <div style="background:#f9fafb;border-radius:10px;padding:14px 16px">
                  <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">Value</div>
                  <div style="font-size:18px;font-weight:800;color:#111827;margin-top:5px">{{ pos.current_value | currency:'USD':'symbol':'1.0-0' }}</div>
                </div>
                <div style="background:#f9fafb;border-radius:10px;padding:14px 16px">
                  <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">Weight</div>
                  <div style="font-size:18px;font-weight:800;color:#8b5cf6;margin-top:5px">{{ pos.weight | number:'1.2-2' }}%</div>
                </div>
                <div style="background:#f9fafb;border-radius:10px;padding:14px 16px">
                  <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">Price</div>
                  <div style="font-size:18px;font-weight:800;color:#111827;margin-top:5px">{{ pos.last_price | currency:'USD':'symbol':'1.2-2' }}</div>
                </div>
                <div style="background:#f9fafb;border-radius:10px;padding:14px 16px">
                  <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">Quantity</div>
                  <div style="font-size:18px;font-weight:800;color:#111827;margin-top:5px">{{ pos.quantity | number:'1.0-2' }}</div>
                </div>
              </div>

              <!-- Meta fields -->
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #f3f4f6;border-radius:10px;overflow:hidden;margin-bottom:20px">
                <div *ngFor="let f of posFields(pos); let i=index"
                  style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f3f4f6"
                  [style.border-right]="i%2===0?'1px solid #f3f4f6':'none'">
                  <span style="font-size:12px;color:#9ca3af;font-weight:500">{{ f.label }}</span>
                  <span style="font-size:12px;font-weight:600;color:#374151">{{ f.value }}</span>
                </div>
              </div>

              <!-- ETF top holdings -->
              <ng-container *ngIf="isFund(pos)">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                  <div style="font-size:14px;font-weight:700;color:#111827">Top 10 Holdings</div>
                  <button class="btn btn-primary" (click)="fetchTopHoldings(pos.symbol)" [disabled]="holdingsLoading()">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" [style.animation]="holdingsLoading()?'spin 0.8s linear infinite':''"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                    {{ holdingsLoading() ? 'Fetching from Yahoo...' : topHoldings().length ? 'Refresh' : 'Fetch from Yahoo Finance' }}
                  </button>
                </div>
                <div *ngIf="topHoldings().length === 0 && !holdingsLoading()" style="padding:16px;background:#f9fafb;border-radius:10px;font-size:13px;color:#6b7280;text-align:center">
                  Click "Fetch from Yahoo Finance" to load live top-10 holdings
                </div>
                <div *ngIf="holdingsLoading()" style="padding:24px;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>
                <div *ngIf="topHoldings().length > 0" style="border:1px solid #f3f4f6;border-radius:10px;overflow:hidden">
                  <div *ngFor="let h of topHoldings(); let i=index"
                    style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid #f9fafb"
                    [style.border-bottom]="i===topHoldings().length-1?'none':''">
                    <div style="width:22px;font-size:11px;color:#9ca3af;font-weight:600;text-align:center">{{ i+1 }}</div>
                    <div style="flex:1">
                      <div style="font-size:13px;font-weight:700;color:#111827">{{ h.symbol }}</div>
                      <div style="font-size:11px;color:#9ca3af">{{ h.name }}</div>
                    </div>
                    <div style="text-align:right">
                      <div style="font-size:13px;font-weight:700;color:#8b5cf6">{{ h.weight | number:'1.2-2' }}%</div>
                      <div style="font-size:10px;color:#9ca3af">{{ h.source }}</div>
                    </div>
                  </div>
                  <div style="padding:8px 16px;background:#f9fafb;font-size:11px;color:#9ca3af;border-top:1px solid #f3f4f6">
                    Source: Yahoo Finance · Live data
                  </div>
                </div>
              </ng-container>
            </div>
          </div>
        </div>
      </div>
    </ng-container>
  `
})
export class DrilldownComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private activePortfolio = inject(ActivePortfolioService);
  private navState = inject(NavigationStateService);
  private router = inject(Router);
  private sub!: Subscription;

  positions = signal<Position[]>([]);
  loading = signal(false);
  activeLens: DrillLens = 'sector';
  search = '';
  selectedGroup = signal<string>('All');
  selectedPosition = signal<Position | null>(null);
  topHoldings = signal<TopHolding[]>([]);
  holdingsLoading = signal(false);

  private readonly LABELS: Record<DrillLens, string> = {
    sector: 'Sector', theme: 'Theme', risk_bucket: 'Risk Bucket',
    asset_type: 'Asset Type', region: 'Region'
  };
  lensLabel() { return this.LABELS[this.activeLens]; }

  maxWeight = computed(() => Math.max(...this.positions().map(p => p.weight ?? 0), 1));
  weightPct(w: number) { return Math.min((w / this.maxWeight()) * 100, 100); }

  isFund(p: Position) { return p.asset_type === 'ETF' || p.asset_type === 'Mutual Fund' || p.asset_type === 'Leveraged ETF'; }

  typeBadge(t: string | null) {
    return { 'type-etf': t==='ETF'||t==='Leveraged ETF', 'type-stock': t==='Stock'||t==='ADR', 'type-mf': t==='Mutual Fund', 'type-cash': t==='Cash', 'type-other': false };
  }

  posFields(p: Position) {
    return [
      { label: 'Sector',      value: p.sector      ?? '—' },
      { label: 'Theme',       value: p.theme        ?? '—' },
      { label: 'Industry',    value: p.industry     ?? '—' },
      { label: 'Region',      value: p.region       ?? '—' },
      { label: 'Risk Bucket', value: p.risk_bucket  ?? '—' },
      { label: 'Price Source', value: p.price_source ?? '—' },
    ];
  }

  groupedRows = computed(() => {
    const total = this.positions().reduce((s, p) => s + (p.current_value ?? 0), 0);
    const map: Record<string, { value: number; count: number }> = {};
    for (const p of this.positions()) {
      const k = (p[this.activeLens] as string) || 'Unclassified';
      const b = map[k] ??= { value: 0, count: 0 };
      b.value += p.current_value ?? 0; b.count++;
    }
    return Object.entries(map)
      .map(([name, { value, count }]) => ({ name, value: Math.round(value*100)/100, count, weight: total ? Math.round(value/total*1000)/10 : 0 }))
      .sort((a, b) => b.value - a.value);
  });

  selectedGroupPositions = computed(() => {
    const g = this.selectedGroup();
    if (g === 'All') return this.positions();
    return this.positions().filter(p => (p[this.activeLens] as string) === g);
  });

  filteredGroupPositions = computed(() => {
    const q = this.search.toLowerCase();
    if (!q) return this.selectedGroupPositions();
    return this.selectedGroupPositions().filter(p => p.symbol.toLowerCase().includes(q) || (p.name ?? '').toLowerCase().includes(q));
  });

  selectedGroupValue  = computed(() => this.selectedGroupPositions().reduce((s, p) => s + (p.current_value ?? 0), 0));
  selectedGroupWeight = computed(() => this.selectedGroupPositions().reduce((s, p) => s + (p.weight ?? 0), 0));

  onLensChange(lens: DrillLens) {
    this.activeLens = lens;
    this.selectedGroup.set(this.groupedRows()[0]?.name ?? 'All');
    this.selectedPosition.set(null); this.topHoldings.set([]);
  }

  onPositionClick(p: Position) {
    this.selectedPosition.set(p);
    this.topHoldings.set([]);
    // Auto-fetch holdings for ETFs/funds
    if (this.isFund(p)) this.fetchTopHoldings(p.symbol);
  }

  fetchTopHoldings(symbol: string) {
    const pid = this.activePortfolio.id;
    if (!pid) return;
    this.holdingsLoading.set(true);
    this.http.get<{ symbol: string; holdings: TopHolding[]; source: string }>
      (`${environment.apiUrl}/portfolios/${pid}/top-holdings/${symbol}`)
      .subscribe({
        next: res => { this.topHoldings.set(res.holdings ?? []); this.holdingsLoading.set(false); },
        error: () => this.holdingsLoading.set(false)
      });
  }

  ngOnInit() {
    this.sub = this.activePortfolio.id$.pipe(filter(id => !!id)).subscribe(id => this.loadData(id));
    // Pick up context set by dashboard/holdings/risk/charts
    const ctx = this.navState.drillContext();
    if (ctx) { this.activeLens = ctx.lens; this.selectedGroup.set(ctx.group); }
  }
  ngOnDestroy() { this.sub?.unsubscribe(); }

  loadData(id: string) {
    this.loading.set(true);
    this.http.get<Position[]>(`${environment.apiUrl}/portfolios/${id}/positions`).subscribe({
      next: p => {
        this.positions.set(p);
        const ctx = this.navState.drillContext();
        if (ctx) { this.activeLens = ctx.lens; this.selectedGroup.set(ctx.group); }
        else { this.selectedGroup.set(this.groupedRows()[0]?.name ?? 'All'); }
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }
}
