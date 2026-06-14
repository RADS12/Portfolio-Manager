import { Component, inject, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ExposureResponse, TrueExposureItem, Position } from '../../core/models/portfolio.models';
import { ActivePortfolioService } from '../../shell/shell.component';
import { NavigationStateService } from '../../core/state/navigation.service';

@Component({
  selector: 'app-exposure',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DecimalPipe],
  template: `
    <div class="loading-wrap" *ngIf="loading()"><div class="spinner"></div></div>

    <ng-container *ngIf="!loading()">

      <div style="background:#ede9fe;border:1.5px solid #c4b5fd;border-radius:12px;padding:16px 20px;margin-bottom:22px;font-size:13px;color:#5b21b6;display:flex;align-items:flex-start;gap:12px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div><strong>Look-through exposure</strong> — Direct stocks + ETF/Fund top-10 holdings unwrapped. Click any row to see source breakdown, then navigate to Drill-Down for full analysis.</div>
      </div>

      <!-- No data fallback -->
      <ng-container *ngIf="!exposure() || exposure()!.exposures.length === 0">
        <div class="panel">
          <div class="panel-header"><div class="panel-title">True Stock Exposure</div></div>
          <div style="padding:32px;text-align:center">
            <div style="font-size:15px;font-weight:600;color:#6b7280;margin-bottom:8px">ETF look-through not yet available</div>
            <div style="font-size:13px;color:#9ca3af;margin-bottom:24px">Click <strong>Refresh Prices</strong> in the topbar to fetch ETF holdings from Yahoo Finance</div>
            <div style="text-align:left;max-width:520px;margin:0 auto">
              <div style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Direct stock positions ({{ directStocks().length }})</div>
              <div *ngFor="let p of directStocks().slice(0,12)" (click)="drillToPosition(p)"
                style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #f3f4f6;cursor:pointer;transition:background 0.1s"
                onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background=''">
                <div style="font-weight:800;font-size:14px;color:#111827;width:64px">{{ p.symbol }}</div>
                <div style="flex:1;font-size:12px;color:#6b7280">{{ p.name }}</div>
                <div style="font-size:13px;font-weight:700;color:#8b5cf6">{{ p.weight | number:'1.2-2' }}%</div>
                <div style="font-size:12px;color:#9ca3af">{{ p.current_value | currency:'USD':'symbol':'1.0-0' }}</div>
                <span style="font-size:11px;color:#8b5cf6">→ Drill</span>
              </div>
            </div>
          </div>
        </div>
      </ng-container>

      <!-- Full table -->
      <ng-container *ngIf="exposure() && exposure()!.exposures.length > 0">
        <div class="filter-bar">
          <div class="search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input class="search-input" [(ngModel)]="search" (ngModelChange)="applyFilter()" placeholder="Search by symbol or name…">
          </div>
          <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:#6b7280;cursor:pointer;font-weight:500">
            <input type="checkbox" [(ngModel)]="majorOnly" (ngModelChange)="applyFilter()"> Major only (≥1%)
          </label>
          <span style="margin-left:auto;font-size:12px;color:#9ca3af;font-weight:500">
            {{ filtered().length }} exposures · as of {{ exposure()!.as_of_utc | date:'shortTime' }}
          </span>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div>
              <div class="panel-title">True Stock Exposure</div>
              <div class="panel-sub">Click a row to see source breakdown · Click "→ Drill" to analyse in Drill-Down</div>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th><th>Name</th><th>Sector</th><th>Theme</th>
                  <th class="td-right">Via funds</th>
                  <th class="td-right">Value</th>
                  <th class="td-right">Weight</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let e of filtered()" (click)="selectedExposure.set(e)"
                  [style.background]="selectedExposure()?.symbol===e.symbol?'#f5f3ff':''">
                  <td class="td-symbol">{{ e.symbol }}</td>
                  <td class="td-name">{{ e.name }}</td>
                  <td style="font-size:12px;color:#6b7280">{{ e.sector }}</td>
                  <td style="font-size:12px;color:#6b7280">{{ e.theme }}</td>
                  <td class="td-right">
                    <span style="font-size:12px;color:#8b5cf6;font-weight:600">{{ e.source_count }} fund{{ e.source_count>1?'s':'' }}</span>
                  </td>
                  <td class="td-right td-mono" style="font-size:13px;font-weight:700">{{ e.value | currency:'USD':'symbol':'1.0-0' }}</td>
                  <td class="td-right">
                    <div class="weight-wrap">
                      <span style="font-size:13px;font-weight:700">{{ e.weight | number:'1.2-2' }}%</span>
                      <div class="weight-track"><div class="weight-fill" [style.width.%]="weightPct(e.weight)"></div></div>
                    </div>
                  </td>
                  <td style="text-align:right">
                    <button (click)="$event.stopPropagation(); drillToExposure(e)"
                      style="font-size:11px;color:#8b5cf6;background:#ede9fe;border:none;padding:3px 9px;border-radius:6px;cursor:pointer;font-weight:600">
                      → Drill
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Source detail -->
        <div class="panel" *ngIf="selectedExposure() as e">
          <div class="panel-header">
            <div>
              <div style="font-size:18px;font-weight:800;color:#111827">{{ e.symbol }} — {{ e.name }}</div>
              <div class="panel-sub">How this exposure is built from your holdings</div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary" (click)="drillToExposure(e)">→ Drill-Down</button>
              <button (click)="selectedExposure.set(null)" style="background:#f3f4f6;border:none;cursor:pointer;color:#6b7280;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center">✕</button>
            </div>
          </div>
          <div style="padding:16px 20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;border-bottom:1px solid #f3f4f6">
            <div style="background:#f9fafb;border-radius:10px;padding:14px 16px">
              <div style="font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase">Total Exposure</div>
              <div style="font-size:18px;font-weight:800;color:#111827;margin-top:4px">{{ e.value | currency:'USD':'symbol':'1.0-0' }}</div>
            </div>
            <div style="background:#f9fafb;border-radius:10px;padding:14px 16px">
              <div style="font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase">Portfolio Weight</div>
              <div style="font-size:18px;font-weight:800;color:#8b5cf6;margin-top:4px">{{ e.weight | number:'1.2-2' }}%</div>
            </div>
            <div style="background:#f9fafb;border-radius:10px;padding:14px 16px">
              <div style="font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase">Source Count</div>
              <div style="font-size:18px;font-weight:800;color:#111827;margin-top:4px">{{ e.source_count }} fund{{ e.source_count>1?'s':'' }}</div>
            </div>
          </div>
          <div style="padding:4px 0">
            <div *ngFor="let s of e.sources"
              style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid #f9fafb">
              <div>
                <div style="font-size:13px;font-weight:600;color:#111827">{{ s.fund === 'Direct' ? 'Direct position' : (s.fund_name + ' (' + s.fund + ')') }}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:2px">
                  {{ s.fund === 'Direct' ? 'Held directly in portfolio' : 'Fund weight: ' + (s.fund_weight | number:'1.2-2') + '% · Holding weight: ' + (s.holding_weight | number:'1.2-2') + '%' }}
                </div>
              </div>
              <div style="font-size:13px;font-weight:700;color:#8b5cf6">{{ s.value | currency:'USD':'symbol':'1.0-0' }}</div>
            </div>
          </div>
        </div>
      </ng-container>
    </ng-container>
  `
})
export class ExposureComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private activePortfolio = inject(ActivePortfolioService);
  private navState = inject(NavigationStateService);
  private router = inject(Router);
  private sub!: Subscription;

  exposure = signal<ExposureResponse | null>(null);
  positions = signal<Position[]>([]);
  filtered  = signal<TrueExposureItem[]>([]);
  loading = signal(false);
  search = ''; majorOnly = false;
  selectedExposure = signal<TrueExposureItem | null>(null);

  maxWeight = computed(() => Math.max(...(this.exposure()?.exposures ?? []).map(e => e.weight), 1));
  weightPct(w: number) { return Math.min((w / this.maxWeight()) * 100, 100); }
  directStocks = computed(() => this.positions().filter(p => p.asset_type === 'Stock' || p.asset_type === 'ADR'));

  applyFilter() {
    let list = this.exposure()?.exposures ?? [];
    if (this.majorOnly) list = list.filter(e => e.is_major);
    if (this.search) {
      const q = this.search.toLowerCase();
      list = list.filter(e => e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q));
    }
    this.filtered.set(list);
  }

  drillToPosition(p: Position) {
    this.navState.navigateToDrill('sector', p.sector ?? 'All');
    this.router.navigate(['/drilldown']);
  }

  drillToExposure(e: TrueExposureItem) {
    this.navState.navigateToDrill('sector', e.sector ?? 'All');
    this.router.navigate(['/drilldown']);
  }

  ngOnInit() {
    this.sub = this.activePortfolio.id$.pipe(filter(id => !!id)).subscribe(id => this.loadData(id));
  }
  ngOnDestroy() { this.sub?.unsubscribe(); }

  loadData(id: string) {
    this.loading.set(true);
    this.http.get<Position[]>(`${environment.apiUrl}/portfolios/${id}/positions`).subscribe(p => this.positions.set(p));
    this.http.get<ExposureResponse>(`${environment.apiUrl}/portfolios/${id}/exposure`).subscribe({
      next: e => { this.exposure.set(e); this.filtered.set(e.exposures); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }
}
