import { Component, inject, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Position, Summary } from '../../core/models/portfolio.models';
import { ActivePortfolioService } from '../../shell/shell.component';
import { NavigationStateService } from '../../core/state/navigation.service';

@Component({
  selector: 'app-risk',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DecimalPipe],
  template: `
    <div class="loading-wrap" *ngIf="loading()"><div class="spinner"></div></div>

    <ng-container *ngIf="!loading() && positions().length > 0">

      <!-- Diagnosis banner -->
      <div style="background:#0f1117;border-radius:16px;padding:24px 28px;margin-bottom:24px;color:#fff">
        <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px;font-weight:600">Portfolio Diagnosis</div>
        <div style="font-size:20px;font-weight:800;margin-bottom:16px;line-height:1.3;letter-spacing:-0.3px">{{ diagnosis() }}</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          <div style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px 18px;text-align:center;cursor:pointer" (click)="drillTo('risk_bucket','Very High Risk')">
            <div style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:500">Speculative tail</div>
            <div style="font-size:22px;font-weight:800;color:#f87171;margin-top:4px">{{ speculativeWeight() | number:'1.1-1' }}%</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px">→ View</div>
          </div>
          <div style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:12px 18px;text-align:center;cursor:pointer" (click)="drillTo('risk_bucket','High Growth / High Volatility')">
            <div style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:500">High growth</div>
            <div style="font-size:22px;font-weight:800;color:#fbbf24;margin-top:4px">{{ highGrowthWeight() | number:'1.1-1' }}%</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px">→ View</div>
          </div>
          <div style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:10px;padding:12px 18px;text-align:center;cursor:pointer" (click)="drillTo('risk_bucket','Cash / Defensive')">
            <div style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:500">Cash buffer</div>
            <div style="font-size:22px;font-weight:800;color:#34d399;margin-top:4px">{{ cashWeight() | number:'1.1-1' }}%</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px">→ View</div>
          </div>
          <div style="background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:10px;padding:12px 18px;text-align:center">
            <div style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:500">Top 5 concentration</div>
            <div style="font-size:22px;font-weight:800;color:#a78bfa;margin-top:4px">{{ top5Weight() | number:'1.1-1' }}%</div>
          </div>
        </div>
      </div>

      <div class="three-col">
        <!-- Concentration -->
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Concentration Risk</div>
            <div class="panel-sub">Largest positions — click to drill</div>
          </div>
          <div style="padding:4px 0">
            <div *ngFor="let p of positions().slice(0,10)"
              (click)="drillTo('sector', p.sector ?? 'All')"
              style="display:flex;align-items:center;gap:12px;padding:10px 18px;cursor:pointer;transition:background 0.1s;border-bottom:1px solid #f9fafb"
              onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background=''">
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:800;color:#111827">{{ p.symbol }}</div>
                <div style="font-size:11px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ p.name }}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:13px;font-weight:700" [style.color]="p.weight>5?'#ef4444':p.weight>3?'#f59e0b':'#10b981'">{{ p.weight | number:'1.1-1' }}%</div>
                <div style="font-size:11px;color:#9ca3af">{{ p.current_value | currency:'USD':'symbol':'1.0-0' }}</div>
              </div>
              <span style="font-size:11px;color:#8b5cf6;opacity:0.6">→</span>
            </div>
          </div>
        </div>

        <!-- Speculative -->
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Very High Risk</div>
            <div class="panel-sub">Speculative & leveraged — click to drill</div>
          </div>
          <div *ngIf="speculativePositions().length === 0" class="empty-state" style="padding:28px"><p>No very-high-risk positions</p></div>
          <div style="padding:4px 0">
            <div *ngFor="let p of speculativePositions()"
              (click)="drillTo('risk_bucket','Very High Risk')"
              style="display:flex;align-items:center;gap:12px;padding:10px 18px;cursor:pointer;transition:background 0.1s;border-bottom:1px solid #f9fafb"
              onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background=''">
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:800;color:#111827">{{ p.symbol }}</div>
                <div style="font-size:11px;color:#9ca3af">{{ p.theme }}</div>
              </div>
              <div style="text-align:right">
                <span style="font-size:12px;padding:3px 9px;background:#fee2e2;color:#991b1b;border-radius:20px;font-weight:600">{{ p.weight | number:'1.2-2' }}%</span>
                <div style="font-size:11px;color:#9ca3af;margin-top:3px">{{ p.current_value | currency:'USD':'symbol':'1.0-0' }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Theme overlap -->
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Theme Overlap</div>
            <div class="panel-sub">Correlated exposure — click to drill</div>
          </div>
          <div class="panel-body">
            <div *ngFor="let t of themeConcentration()" style="margin-bottom:16px;cursor:pointer" (click)="drillTo('theme', t.theme)">
              <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
                <span style="color:#374151;font-weight:600">{{ t.theme }}</span>
                <span style="font-weight:700;color:#111827">{{ t.weight | number:'1.1-1' }}%</span>
              </div>
              <div style="height:7px;background:#f3f4f6;border-radius:4px;overflow:hidden;margin-bottom:3px">
                <div [style.width.%]="t.weight" [style.background]="t.weight>20?'#ef4444':t.weight>10?'#f59e0b':'#8b5cf6'"
                  style="height:100%;border-radius:4px;transition:width 0.5s ease"></div>
              </div>
              <div style="font-size:11px;color:#9ca3af">{{ t.count }} positions · {{ t.value | currency:'USD':'symbol':'1.0-0' }} → Drill</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Alerts -->
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Risk Alerts</div></div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:12px">
          <div *ngFor="let alert of riskAlerts()"
            style="display:flex;align-items:flex-start;gap:14px;padding:14px 16px;border-radius:10px;cursor:pointer;transition:opacity 0.1s"
            [style.background]="alert.level==='high'?'#fef2f2':alert.level==='medium'?'#fffbeb':'#f0fdf4'"
            (click)="alert.lens ? drillTo(alert.lens, alert.group) : null"
            onmouseenter="this.style.opacity='0.85'" onmouseleave="this.style.opacity='1'">
            <div style="font-size:22px;flex-shrink:0">{{ alert.icon }}</div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:700" [style.color]="alert.level==='high'?'#991b1b':alert.level==='medium'?'#92400e':'#065f46'">{{ alert.title }}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:3px">{{ alert.detail }}</div>
            </div>
            <span *ngIf="alert.lens" style="font-size:11px;color:#8b5cf6;font-weight:600;align-self:center">→ Drill</span>
          </div>
          <div *ngIf="riskAlerts().length === 0" style="text-align:center;color:#9ca3af;font-size:13px;padding:8px">No significant risk alerts</div>
        </div>
      </div>
    </ng-container>
  `
})
export class RiskComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private activePortfolio = inject(ActivePortfolioService);
  private navState = inject(NavigationStateService);
  private router = inject(Router);
  private sub!: Subscription;

  positions = signal<Position[]>([]);
  summary   = signal<Summary | null>(null);
  loading   = signal(false);

  speculativePositions = computed(() => this.positions().filter(p => p.risk_bucket === 'Very High Risk'));
  speculativeWeight    = computed(() => this.speculativePositions().reduce((s, p) => s + (p.weight ?? 0), 0));
  highGrowthWeight     = computed(() => this.positions().filter(p => p.risk_bucket === 'High Growth / High Volatility').reduce((s, p) => s + (p.weight ?? 0), 0));
  cashWeight           = computed(() => this.positions().filter(p => p.risk_bucket === 'Cash / Defensive').reduce((s, p) => s + (p.weight ?? 0), 0));
  top5Weight           = computed(() => this.positions().slice(0, 5).reduce((s, p) => s + (p.weight ?? 0), 0));

  themeConcentration = computed(() => {
    const total = this.positions().reduce((s, p) => s + (p.current_value ?? 0), 0);
    const map: Record<string, { value: number; count: number }> = {};
    for (const p of this.positions()) {
      const k = p.theme || 'Unclassified';
      const b = map[k] ??= { value: 0, count: 0 };
      b.value += p.current_value ?? 0; b.count++;
    }
    return Object.entries(map).map(([theme, { value, count }]) => ({ theme, value, count, weight: total ? value / total * 100 : 0 }))
      .sort((a, b) => b.weight - a.weight).slice(0, 8);
  });

  diagnosis = computed(() => {
    if (this.speculativeWeight() > 15) return 'High speculative tail — consider trimming very-high-risk positions';
    if (this.highGrowthWeight() > 40)  return 'Growth-heavy — highly correlated to tech/AI market cycles';
    if (this.cashWeight() > 35)        return 'High cash position — significant dry powder available';
    if (this.top5Weight() > 50)        return 'Concentrated top-5 — single-name risk elevated';
    return 'Balanced risk profile — diversified across sectors and risk buckets';
  });

  riskAlerts = computed(() => {
    const alerts: any[] = [];
    const big = this.positions().filter(p => (p.weight ?? 0) > 8);
    if (big.length) alerts.push({ icon: '⚠️', level: 'high', lens: 'sector', group: big[0].sector ?? 'All',
      title: `${big.length} position(s) exceed 8% of portfolio`,
      detail: big.map(p => `${p.symbol} (${p.weight?.toFixed(1)}%)`).join(', ') });
    if (this.speculativeWeight() > 15) alerts.push({ icon: '🔴', level: 'high', lens: 'risk_bucket', group: 'Very High Risk',
      title: `Speculative tail at ${this.speculativeWeight().toFixed(1)}%`,
      detail: 'Very-high-risk positions exceed recommended 15% threshold' });
    const bigTheme = this.themeConcentration().filter(t => t.weight > 25);
    if (bigTheme.length) alerts.push({ icon: '🟡', level: 'medium', lens: 'theme', group: bigTheme[0].theme,
      title: 'High thematic concentration',
      detail: bigTheme.map(t => `${t.theme} at ${t.weight.toFixed(1)}%`).join(', ') });
    if (this.cashWeight() > 30) alerts.push({ icon: '💵', level: 'low', lens: 'risk_bucket', group: 'Cash / Defensive',
      title: `Cash at ${this.cashWeight().toFixed(1)}% — consider deployment`,
      detail: 'High cash position reduces long-term return potential' });
    if (this.top5Weight() > 50) alerts.push({ icon: '🟡', level: 'medium', lens: null, group: '',
      title: `Top 5 = ${this.top5Weight().toFixed(1)}% of portfolio`,
      detail: 'Significant single-name concentration risk' });
    return alerts;
  });

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
      next: p => { this.positions.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }
}
