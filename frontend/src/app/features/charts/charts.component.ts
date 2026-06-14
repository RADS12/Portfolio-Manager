import { Component, inject, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Position, Summary } from '../../core/models/portfolio.models';
import { ActivePortfolioService } from '../../shell/shell.component';
import { NavigationStateService } from '../../core/state/navigation.service';

type MapLens = 'sector'|'theme'|'risk_bucket'|'asset_type';

@Component({
  selector: 'app-charts',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DecimalPipe],
  template: `
    <div class="loading-wrap" *ngIf="loading()"><div class="spinner"></div></div>

    <ng-container *ngIf="!loading() && summary()">

      <!-- Treemap -->
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Portfolio Treemap</div>
            <div class="panel-sub">Rectangle size = portfolio weight · Click any segment to drill in</div>
          </div>
          <select class="filter-select" [(ngModel)]="treemapLens" (ngModelChange)="buildTreemap()">
            <option value="sector">By Sector</option>
            <option value="theme">By Theme</option>
            <option value="risk_bucket">By Risk</option>
            <option value="asset_type">By Asset Type</option>
          </select>
        </div>
        <div class="panel-body" style="padding:14px">
          <div style="display:flex;flex-wrap:wrap;gap:4px;min-height:220px">
            <div *ngFor="let cell of treemapCells()"
              [style.width]="cell.widthPct + '%'"
              [style.height.px]="cell.height"
              [style.background]="cell.color"
              [style.border-radius.px]="8"
              [style.display]="'flex'"
              [style.flex-direction]="'column'"
              [style.justify-content]="'flex-end'"
              [style.padding]="'10px'"
              style="overflow:hidden;cursor:pointer;transition:opacity 0.12s;position:relative"
              onmouseenter="this.style.opacity='0.82'"
              onmouseleave="this.style.opacity='1'"
              (click)="drillTo(treemapLens, cell.name)"
              [title]="cell.name + ': ' + cell.weight.toFixed(1) + '% — click to drill in'">
              <div *ngIf="cell.widthPct > 5" style="color:#fff;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.9">{{ cell.name }}</div>
              <div *ngIf="cell.widthPct > 5" style="color:rgba(255,255,255,0.9);font-size:15px;font-weight:800;margin-top:2px">{{ cell.weight | number:'1.1-1' }}%</div>
              <div style="position:absolute;bottom:6px;right:8px;font-size:10px;color:rgba(255,255,255,0.5)" *ngIf="cell.widthPct > 10">→ drill</div>
            </div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:0">

        <!-- Donut -->
        <div class="panel">
          <div class="panel-header"><div class="panel-title">Sector Breakdown</div><div class="panel-sub">Click to drill in</div></div>
          <div class="panel-body" style="display:flex;align-items:center;gap:24px">
            <svg viewBox="0 0 180 180" style="width:180px;height:180px;flex-shrink:0">
              <g transform="translate(90,90)">
                <path *ngFor="let s of donutSectors()" [attr.d]="s.path" [attr.fill]="s.color"
                  stroke="#fff" stroke-width="2.5" style="cursor:pointer;transition:opacity 0.12s"
                  onmouseenter="this.style.opacity='0.8'" onmouseleave="this.style.opacity='1'"
                  (click)="drillTo('sector', s.name)" [attr.title]="s.name"></path>
                <circle r="58" fill="#fff"></circle>
                <text text-anchor="middle" dy="-8" style="font-size:12px;fill:#9ca3af;font-weight:500">Total</text>
                <text text-anchor="middle" dy="10" style="font-size:14px;font-weight:800;fill:#111827">{{ summary()!.total_value | currency:'USD':'symbol':'1.0-0' }}</text>
              </g>
            </svg>
            <div style="flex:1;min-width:0">
              <div *ngFor="let item of summary()!.sector_allocation.slice(0,8)"
                style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;padding:4px 6px;border-radius:6px;transition:background 0.1s"
                (click)="drillTo('sector',item.name)"
                onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background=''">
                <div style="width:9px;height:9px;border-radius:50%;flex-shrink:0" [style.background]="sectorColor(item.name)"></div>
                <span style="font-size:13px;color:#374151;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500">{{ item.name }}</span>
                <span style="font-size:13px;font-weight:700;color:#111827">{{ item.weight | number:'1.1-1' }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Risk bars -->
        <div class="panel">
          <div class="panel-header"><div class="panel-title">Risk Distribution</div><div class="panel-sub">Click to drill in</div></div>
          <div class="panel-body">
            <div *ngFor="let item of summary()!.risk_allocation" style="margin-bottom:18px;cursor:pointer;padding:6px;border-radius:8px;transition:background 0.1s"
              (click)="drillTo('risk_bucket', item.name)"
              onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background=''">
              <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
                <span style="color:#374151;font-weight:600">{{ item.name }}</span>
                <span style="font-weight:800;color:#111827">{{ item.weight | number:'1.1-1' }}%</span>
              </div>
              <div style="height:9px;background:#f3f4f6;border-radius:5px;overflow:hidden;margin-bottom:4px">
                <div [style.width.%]="item.weight" [style.background]="riskColor(item.name)"
                  style="height:100%;border-radius:5px;transition:width 0.6s ease"></div>
              </div>
              <div style="font-size:11px;color:#9ca3af">{{ item.value | currency:'USD':'symbol':'1.0-0' }} · {{ item.count }} holdings → Drill</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Top 15 bar -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Top 15 Holdings</div>
          <div class="panel-sub">By portfolio weight · Click to drill by sector</div>
        </div>
        <div class="panel-body">
          <div *ngFor="let p of positions().slice(0,15); let i=index"
            style="display:flex;align-items:center;gap:12px;margin-bottom:10px;cursor:pointer;padding:4px 0"
            (click)="drillTo('sector', p.sector ?? 'All')">
            <div style="width:18px;font-size:11px;color:#9ca3af;text-align:right;font-weight:600;flex-shrink:0">{{ i+1 }}</div>
            <div style="width:68px;font-size:14px;font-weight:800;color:#111827;flex-shrink:0">{{ p.symbol }}</div>
            <div style="flex:1;height:24px;background:#f3f4f6;border-radius:6px;overflow:hidden;position:relative">
              <div [style.width.%]="(p.weight / positions()[0].weight) * 100"
                [style.background]="typeColor(p.asset_type)"
                style="height:100%;border-radius:6px;transition:width 0.5s ease;display:flex;align-items:center;padding-left:10px">
                <span style="font-size:11px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden">{{ p.name }}</span>
              </div>
            </div>
            <div style="width:54px;text-align:right;font-size:14px;font-weight:800;color:#111827;flex-shrink:0">{{ p.weight | number:'1.1-1' }}%</div>
            <div style="width:80px;text-align:right;font-size:12px;color:#6b7280;flex-shrink:0">{{ p.current_value | currency:'USD':'symbol':'1.0-0' }}</div>
          </div>
        </div>
      </div>
    </ng-container>
  `
})
export class ChartsComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private activePortfolio = inject(ActivePortfolioService);
  private navState = inject(NavigationStateService);
  private router = inject(Router);
  private sub!: Subscription;

  positions = signal<Position[]>([]);
  summary   = signal<Summary | null>(null);
  loading   = signal(false);
  treemapLens: MapLens = 'sector';

  private readonly SECTOR_COLORS: Record<string, string> = {
    'Information Technology': '#8b5cf6', 'Industrials': '#3b82f6',
    'Health Care': '#10b981', 'Cash': '#6b7280', 'Financials': '#f59e0b',
    'Communication Services': '#ef4444', 'Consumer Discretionary': '#ec4899',
    'Materials': '#14b8a6', 'Real Estate': '#f97316', 'Utilities': '#84cc16', 'Multi-Sector': '#64748b',
  };
  sectorColor(n: string) { return this.SECTOR_COLORS[n] ?? '#9ca3af'; }
  riskColor(n: string) {
    if (n.includes('Cash')) return '#10b981'; if (n.includes('Core')) return '#3b82f6';
    if (n.includes('High Growth')) return '#f59e0b'; if (n.includes('Very High')) return '#ef4444';
    return '#9ca3af';
  }
  typeColor(t: string | null) {
    return { 'ETF': '#3b82f6', 'Stock': '#8b5cf6', 'Mutual Fund': '#f59e0b', 'Cash': '#6b7280' }[t ?? ''] ?? '#9ca3af';
  }

  donutSectors = computed(() => {
    const allocs = this.summary()?.sector_allocation ?? [];
    const total = allocs.reduce((s, a) => s + a.weight, 0);
    let angle = -Math.PI / 2;
    return allocs.slice(0, 9).map(a => {
      const sweep = (a.weight / total) * Math.PI * 2;
      const x1 = Math.cos(angle) * 84, y1 = Math.sin(angle) * 84;
      const x2 = Math.cos(angle + sweep) * 84, y2 = Math.sin(angle + sweep) * 84;
      const large = sweep > Math.PI ? 1 : 0;
      const path = `M0 0 L${x1.toFixed(2)} ${y1.toFixed(2)} A84 84 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      angle += sweep;
      return { path, color: this.sectorColor(a.name), name: a.name };
    });
  });

  treemapCells = signal<{ name: string; weight: number; widthPct: number; height: number; color: string }[]>([]);
  buildTreemap() {
    const pos = this.positions(); if (!pos.length) return;
    const total = pos.reduce((s, p) => s + (p.current_value ?? 0), 0);
    const map: Record<string, number> = {};
    for (const p of pos) { const k = (p[this.treemapLens as keyof Position] as string) || 'Unclassified'; map[k] = (map[k] ?? 0) + (p.current_value ?? 0); }
    const colors = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899','#14b8a6','#f97316','#84cc16','#64748b'];
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const maxVal = sorted[0]?.[1] ?? 1;
    this.treemapCells.set(sorted.map(([name, value], i) => ({
      name, weight: total ? value / total * 100 : 0,
      widthPct: Math.max(total ? value / total * 100 : 0, 3.5),
      height: Math.max(52, Math.round((value / maxVal) * 200)),
      color: colors[i % colors.length]
    })));
  }

  drillTo(lens: any, group: string) {
    this.navState.navigateToDrill(lens, group);
    this.router.navigate(['/drilldown']);
  }

  ngOnInit() { this.sub = this.activePortfolio.id$.pipe(filter(id => !!id)).subscribe(id => this.loadData(id)); }
  ngOnDestroy() { this.sub?.unsubscribe(); }

  loadData(id: string) {
    this.loading.set(true);
    this.http.get<Summary>(`${environment.apiUrl}/portfolios/${id}/summary`).subscribe(s => this.summary.set(s));
    this.http.get<Position[]>(`${environment.apiUrl}/portfolios/${id}/positions`).subscribe({
      next: p => { this.positions.set(p); this.buildTreemap(); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }
}
