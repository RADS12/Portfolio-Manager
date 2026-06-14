import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { ActivePortfolioService } from '../../shell/shell.component';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="max-width:600px;margin:0 auto">
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Import Portfolio CSV</div>
            <div class="panel-sub">Fidelity, Schwab, E*Trade export formats supported</div>
          </div>
        </div>
        <div class="panel-body">
          <div class="drop-zone" (click)="fileInput.click()"
               (dragover)="$event.preventDefault()"
               (drop)="onDrop($event)">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5" style="margin-bottom:12px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <h3>Drop your CSV here</h3>
            <p>or click to browse &nbsp;·&nbsp; .csv files only &nbsp;·&nbsp; max 10 MB</p>
            <input #fileInput type="file" accept=".csv" style="display:none" (change)="onFile($event)">
          </div>

          <div style="margin-top:16px;padding:12px 14px;background:#f8fafc;border-radius:8px;font-size:12px;border:1px solid #f1f5f9">
            <div style="font-weight:600;margin-bottom:4px;color:#374151">Expected CSV columns:</div>
            <code style="font-size:11px;color:#6b7280">Symbol, Quantity, Last Price, Current Value</code>
          </div>

          <div *ngIf="uploading()" style="margin-top:16px;display:flex;align-items:center;gap:10px;font-size:13px;color:#6b7280">
            <div class="spinner" style="width:18px;height:18px;border-width:2px"></div>
            Importing positions...
          </div>
          <div *ngIf="result()" style="margin-top:16px;padding:12px 14px;background:#d1fae5;border-radius:8px;font-size:13px;color:#065f46;font-weight:500">
            ✓ {{ result() }} — redirecting to dashboard…
          </div>
          <div *ngIf="error()" style="margin-top:16px;padding:12px 14px;background:#fee2e2;border-radius:8px;font-size:13px;color:#991b1b">
            ✗ {{ error() }}
          </div>
        </div>
      </div>
    </div>
  `
})
export class OnboardingComponent {
  private http = inject(HttpClient);
  private router = inject(Router);
  private activePortfolio = inject(ActivePortfolioService);

  uploading = signal(false);
  result = signal('');
  error = signal('');

  onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.upload(file);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) this.upload(file);
  }

  upload(file: File): void {
    const pid = this.activePortfolio.id;
    if (!pid) {
      this.error.set('No portfolio found — please wait a moment and try again');
      return;
    }
    this.uploading.set(true);
    this.result.set('');
    this.error.set('');
    const form = new FormData();
    form.append('file', file);
    this.http.post<any>(`${environment.apiUrl}/portfolios/${pid}/upload`, form).subscribe({
      next: res => {
        this.uploading.set(false);
        this.result.set(`Imported ${res.position_count} positions from ${file.name}`);
        this.activePortfolio.set(pid); // re-emit so dashboard reloads
        setTimeout(() => this.router.navigate(['/dashboard']), 1500);
      },
      error: err => {
        this.uploading.set(false);
        this.error.set(err?.error?.detail ?? 'Upload failed — check the API logs');
      }
    });
  }
}
