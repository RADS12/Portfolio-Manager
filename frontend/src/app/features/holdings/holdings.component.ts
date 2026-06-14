import { Component, inject, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Position } from '../../core/models/portfolio.models';
import { ActivePortfolioService } from '../../shell/shell.component';
import { NavigationStateService } from '../../core/state/navigation.service';

@Component({
  selector: 'app-holdings',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DecimalPipe],
  template: `
    <!-- Filter bar -->
    <div class="filter-bar">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input class="search-input" [(ngModel)]="search" (ngModelChange)="applyFilters()" placeholder="Search symbol or name…">
      </div>
      <select class="filter-select" [(ngModel)]="filterType" (ngModelChange)="applyFilters()">
        <option value="">All types</option>
        <option>ETF</option><option>Stock</option>
        <option>Mutual Fund</option><option>Cash</option>
      </select>
      <select class="filter-select" [(ngModel)]="filterSector" (ngModelChange)="applyFilters()">
        <option value="">All sectors</option>
        <option *ngFor="let s of sectors()">{{ s }}</option>
      </select>
      <select class="filter-select" [(ngModel)]="filterTheme" (ngModelChange)="applyFilters()">
        <option value="">All themes</option>
        <option *ngFor="let t of themes()">{{ t }}</option>
      </select>
      <select class="filter-select" [(ngModel)]="filterRisk" (ngModelChange)="applyFilters()">
        <option value="">All risk levels</option>
        <option *ngFor="let r of risks()">{{ r }}</option>
      </select>
      <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:#6b7280;cursor:pointer;font-weight:500">
        <input type="checkbox" [(ngModel)]="excludeCash" (ngModelChange)="applyFilters()"> Exclude cash
      </label>
      <button class="btn" (click)="clearFilters()" *ngIf="hasActiveFilters()" style="color:#8b5cf6;border-color:#e9d5ff">
        Clear filters ✕
      </button>
      <span style="margin-left:auto;font-size:12px;color:#9ca3af;font-weight:500">
        {{ filtered().length }} of {{ positions().length }} positions
      </span>
      <button class="btn" (click)="exportCsv()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export
      </button>
    </div>

    <div class="loading-wrap" *ngIf="loading()"><div class="spinner"></div></div>

    <div class="empty-state" *ngIf="!loading() && positions().length === 0">
      <h3>No holdings found</h3><p>Upload a CSV from the topbar</p>
    </div>

    <div class="panel" *ngIf="!loading() && positions().length > 0">
      <div class="panel-header">
        <div>
          <div class="panel-title">All Holdings</div>
          <div class="panel-sub">{{ filtered().length }} positions · {{ totalValue() | currency:'USD':'symbol':'1.0-0' }} · Click row to drill in</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th (click)="sort('symbol')" [class.sorted]="sortBy==='symbol'">Symbol {{ si('symbol') }}</th>
              <th>Name</th>
              <th (click)="sort('asset_type')" [class.sorted]="sortBy==='asset_type'">Type {{ si('asset_type') }}</th>
              <th (click)="sort('sector')" [class.sorted]="sortBy==='sector'">Sector {{ si('sector') }}</th>
              <th (click)="sort('theme')" [class.sorted]="sortBy==='theme'">Theme {{ si('theme') }}</th>
              <th (click)="sort('risk_bucket')" [class.sorted]="sortBy==='risk_bucket'">Risk {{ si('risk_bucket') }}</th>
              <th class="td-right" (click)="sort('quantity')" [class.sorted]="sortBy==='quantity'">Qty {{ si('quantity') }}</th>
              <th class="td-right" (click)="sort('last_price')" [class.sorted]="sortBy==='last_price'">Price {{ si('last_price') }}</th>
              <th class="td-right" (click)="sort('current_value')" [class.sorted]="sortBy==='current_value'">Value {{ si('current_value') }}</th>
              <th class="td-right" (click)="sort('weight')" [class.sorted]="sortBy==='weight'">Weight {{ si('weight') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let p of filtered()" (click)="onRowClick(p)">
              <td class="td-symbol">{{ p.symbol }}</td>
              <td class="td-name">{{ p.name }}</td>
              <td><span class="type-badge" [ngClass]="typeBadge(p.asset_type)">{{ p.asset_type }}</span></td>
              <td style="font-size:12px;color:#6b7280;cursor:pointer" (click)="$event.stopPropagation(); drillTo('sector', p.sector!)">
                <span style="text-decoration:underline;text-decoration-color:#d1d5db">{{ p.sector }}</span>
              </td>
              <td style="font-size:12px;color:#6b7280;cursor:pointer" (click)="$event.stopPropagation(); drillTo('theme', p.theme!)">
                <span style="text-decoration:underline;text-decoration-color:#d1d5db">{{ p.theme }}</span>
              </td>
              <td style="font-size:12px;color:#6b7280">{{ p.risk_bucket }}</td>
              <td class="td-right td-mono" style="font-size:13px">{{ p.quantity | number:'1.0-3' }}</td>
              <td class="td-right td-mono" style="font-size:13px">{{ p.last_price | currency:'USD':'symbol':'1.2-2' }}</td>
              <td class="td-right td-mono" style="font-size:13px;font-weight:700">{{ p.current_value | currency:'USD':'symbol':'1.0-0' }}</td>
              <td class="td-right">
                <div class="weight-wrap">
                  <span style="font-size:13px;font-weight:700;min-width:42px;text-align:right">{{ p.weight | number:'1.2-2' }}%</span>
                  <div class="weight-track"><div class="weight-fill" [style.width.%]="weightBarPct(p.weight)"></div></div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="empty-state" style="padding:28px" *ngIf="filtered().length===0 && positions().length>0">
          <h3>No holdings match your filters</h3>
          <p>Try clearing the filters above</p>
        </div>
      </div>
    </div>
  `
})
export class HoldingsComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private activePortfolio = inject(ActivePortfolioService);
  private navState = inject(NavigationStateService);
  private router = inject(Router);
  private sub!: Subscription;

  positions = signal<Position[]>([]);
  filtered  = signal<Position[]>([]);
  loading   = signal(false);

  search = ''; filterType = ''; filterSector = ''; filterTheme = ''; filterRisk = ''; excludeCash = false;
  sortBy: keyof Position = 'current_value';
  sortDir: 'asc' | 'desc' = 'desc';

  sectors  = computed(() => [...new Set(this.positions().map(p => p.sector  ?? '').filter(Boolean))].sort());
  themes   = computed(() => [...new Set(this.positions().map(p => p.theme   ?? '').filter(Boolean))].sort());
  risks    = computed(() => [...new Set(this.positions().map(p => p.risk_bucket ?? '').filter(Boolean))].sort());
  maxWeight = computed(() => Math.max(...this.positions().map(p => p.weight ?? 0), 1));
  totalValue = computed(() => this.filtered().reduce((s, p) => s + (p.current_value ?? 0), 0));
  hasActiveFilters = () => !!(this.search || this.filterType || this.filterSector || this.filterTheme || this.filterRisk || this.excludeCash);

  applyFilters() {
    let list = this.positions();
    if (this.excludeCash) list = list.filter(p => (p.asset_type ?? '').toLowerCase() !== 'cash' && p.symbol !== 'SPAXX');
    if (this.search)       { const q = this.search.toLowerCase(); list = list.filter(p => p.symbol.toLowerCase().includes(q) || (p.name ?? '').toLowerCase().includes(q)); }
    if (this.filterType)   list = list.filter(p => p.asset_type === this.filterType);
    if (this.filterSector) list = list.filter(p => p.sector    === this.filterSector);
    if (this.filterTheme)  list = list.filter(p => p.theme     === this.filterTheme);
    if (this.filterRisk)   list = list.filter(p => p.risk_bucket === this.filterRisk);
    const key = this.sortBy; const dir = this.sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => { const av = (a[key] ?? '') as any; const bv = (b[key] ?? '') as any; return av < bv ? -dir : av > bv ? dir : 0; });
    this.filtered.set(list);
  }

  clearFilters() { this.search=''; this.filterType=''; this.filterSector=''; this.filterTheme=''; this.filterRisk=''; this.excludeCash=false; this.applyFilters(); }

  sort(key: keyof Position) {
    if (this.sortBy === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortBy = key; this.sortDir = 'desc'; }
    this.applyFilters();
  }
  si(key: keyof Position) { return this.sortBy !== key ? '' : this.sortDir === 'asc' ? ' ↑' : ' ↓'; }
  weightBarPct(w: number) { return Math.min((w / this.maxWeight()) * 100, 100); }
  typeBadge(t: string | null) {
    return { 'type-etf': t==='ETF', 'type-stock': t==='Stock', 'type-mf': t==='Mutual Fund', 'type-cash': t==='Cash', 'type-other': !['ETF','Stock','Mutual Fund','Cash'].includes(t??'') };
  }

  onRowClick(p: Position) {
    // ETFs go to drilldown with asset_type=ETF; stocks go to drilldown with their sector
    if (p.asset_type === 'ETF' || p.asset_type === 'Mutual Fund') {
      this.navState.navigateToDrill('asset_type', p.asset_type);
    } else {
      this.navState.navigateToDrill('sector', p.sector ?? 'All');
    }
    this.router.navigate(['/drilldown']);
  }

  drillTo(lens: any, group: string) {
    if (!group) return;
    this.navState.navigateToDrill(lens, group);
    this.router.navigate(['/drilldown']);
  }

  exportCsv() {
    const hdr = ['Symbol','Name','Type','Sector','Theme','Risk','Quantity','Price','Value','Weight'];
    const rows = this.filtered().map(p => [p.symbol,p.name,p.asset_type,p.sector,p.theme,p.risk_bucket,p.quantity,p.last_price,p.current_value,p.weight].join(','));
    const blob = new Blob([[hdr.join(','),...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'holdings.csv'; a.click();
  }

  ngOnInit() { this.sub = this.activePortfolio.id$.pipe(filter(id => !!id)).subscribe(id => this.loadData(id)); }
  ngOnDestroy() { this.sub?.unsubscribe(); }

  loadData(id: string) {
    this.loading.set(true);
    this.http.get<Position[]>(`${environment.apiUrl}/portfolios/${id}/positions`).subscribe({
      next: p => { this.positions.set(p); this.applyFilters(); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }
}
