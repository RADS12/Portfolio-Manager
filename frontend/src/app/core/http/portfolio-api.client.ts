// src/app/core/http/portfolio-api.client.ts
// ───────────────────────────────────────────
// Single typed wrapper for all portfolio API calls.
// Components and services import this — never raw HttpClient.

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ExposureResponse,
  JobStatus,
  Portfolio,
  Position,
  Summary,
  TreemapGroup,
  UploadResponse,
} from '../models/portfolio.models';

@Injectable({ providedIn: 'root' })
export class PortfolioApiClient {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  // ── Portfolios ─────────────────────────────────────────────────────────────

  listPortfolios(): Observable<Portfolio[]> {
    return this.http.get<Portfolio[]>(`${this.base}/portfolios`);
  }

  createPortfolio(name: string, currency = 'USD'): Observable<Portfolio> {
    return this.http.post<Portfolio>(`${this.base}/portfolios`, { name, currency });
  }

  deletePortfolio(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/portfolios/${id}`);
  }

  // ── CSV upload ─────────────────────────────────────────────────────────────

  uploadCsv(portfolioId: string, file: File): Observable<UploadResponse> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<UploadResponse>(
      `${this.base}/portfolios/${portfolioId}/upload`,
      form,
    );
  }

  // ── Portfolio data ─────────────────────────────────────────────────────────

  getPositions(portfolioId: string, live = false): Observable<Position[]> {
    const params = new HttpParams().set('live', live);
    return this.http.get<Position[]>(
      `${this.base}/portfolios/${portfolioId}/positions`,
      { params },
    );
  }

  getSummary(portfolioId: string, live = false): Observable<Summary> {
    const params = new HttpParams().set('live', live);
    return this.http.get<Summary>(
      `${this.base}/portfolios/${portfolioId}/summary`,
      { params },
    );
  }

  getTreemap(
    portfolioId: string,
    groupBy: string = 'sector',
  ): Observable<TreemapGroup[]> {
    return this.http.get<TreemapGroup[]>(
      `${this.base}/portfolios/${portfolioId}/treemap/${groupBy}`,
    );
  }

  getTrueExposure(portfolioId: string, live = false): Observable<ExposureResponse> {
    const params = new HttpParams().set('live', live);
    return this.http.get<ExposureResponse>(
      `${this.base}/portfolios/${portfolioId}/exposure`,
      { params },
    );
  }

  // ── Job polling ────────────────────────────────────────────────────────────

  getJobStatus(jobId: string): Observable<JobStatus> {
    return this.http.get<JobStatus>(`${this.base}/portfolios/jobs/${jobId}`);
  }
}
