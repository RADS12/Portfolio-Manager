// src/app/core/state/portfolio.store.ts
// ───────────────────────────────────────
// NgRx SignalStore — replaces the 30+ individual signals from v42 app.component.ts.
// One store, clearly structured, easy to debug.

import { inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, EMPTY, interval } from 'rxjs';
import { computed } from '@angular/core';
import {
  ExposureResponse,
  GroupByKey,
  HoldingsFilter,
  JobStatus,
  Portfolio,
  Position,
  Summary,
  TreemapGroup,
  ViewName,
} from '../models/portfolio.models';
import { PortfolioApiClient } from '../http/portfolio-api.client';

// ── State shape ───────────────────────────────────────────────────────────────

interface PortfolioState {
  // Data
  portfolios: Portfolio[];
  activePortfolioId: string | null;
  positions: Position[];
  summary: Summary | null;
  treemap: TreemapGroup[];
  exposure: ExposureResponse | null;

  // Loading flags
  portfoliosLoading: boolean;
  positionsLoading: boolean;
  summaryLoading: boolean;
  exposureLoading: boolean;
  exposureLoaded: boolean;
  refreshing: boolean;

  // Refresh job tracking
  activeJobId: string | null;
  activeJob: JobStatus | null;

  // UI state
  activeView: ViewName;
  previousView: ViewName;
  groupBy: GroupByKey;
  selectedGroup: string;
  filter: HoldingsFilter;
  sortBy: keyof Position;
  sortDirection: 'asc' | 'desc';
  selectedPosition: Position | null;
  topHoldingLimit: number;
}

const initialState: PortfolioState = {
  portfolios: [],
  activePortfolioId: null,
  positions: [],
  summary: null,
  treemap: [],
  exposure: null,

  portfoliosLoading: false,
  positionsLoading: false,
  summaryLoading: false,
  exposureLoading: false,
  exposureLoaded: false,
  refreshing: false,

  activeJobId: null,
  activeJob: null,

  activeView: 'dashboard',
  previousView: 'dashboard',
  groupBy: 'sector',
  selectedGroup: 'All',
  filter: {
    search: '',
    asset_type: 'All',
    sector: 'All',
    theme: 'All',
    risk_bucket: 'All',
    exclude_cash: false,
  },
  sortBy: 'current_value',
  sortDirection: 'desc',
  selectedPosition: null,
  topHoldingLimit: 5,
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const PortfolioStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  // ── Computed signals ────────────────────────────────────────────────────────
  withComputed(({ positions, filter, sortBy, sortDirection, groupBy, selectedGroup, activeJob }) => ({

    filteredPositions: computed(() => {
      const f = filter();
      let result = positions();

      if (f.exclude_cash) {
        result = result.filter(p =>
          (p.asset_type || '').toLowerCase() !== 'cash' &&
          p.symbol !== 'SPAXX',
        );
      }
      if (f.search) {
        const q = f.search.toLowerCase();
        result = result.filter(p =>
          p.symbol.toLowerCase().includes(q) ||
          (p.name || '').toLowerCase().includes(q),
        );
      }
      if (f.asset_type !== 'All') {
        result = result.filter(p => p.asset_type === f.asset_type);
      }
      if (f.sector !== 'All') {
        result = result.filter(p => p.sector === f.sector);
      }
      if (f.theme !== 'All') {
        result = result.filter(p => p.theme === f.theme);
      }
      if (f.risk_bucket !== 'All') {
        result = result.filter(p => p.risk_bucket === f.risk_bucket);
      }

      // Sort
      const key = sortBy() as keyof Position;
      const dir = sortDirection() === 'asc' ? 1 : -1;
      return [...result].sort((a, b) => {
        const av = a[key] ?? 0;
        const bv = b[key] ?? 0;
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }),

    groupedRows: computed(() => {
      const key = groupBy();
      const all = positions();
      const total = all.reduce((s, p) => s + (p.current_value || 0), 0);
      const buckets: Record<string, { value: number; count: number }> = {};
      for (const p of all) {
        const name = (p[key] as string) || 'Unclassified';
        const b = buckets[name] ??= { value: 0, count: 0 };
        b.value += p.current_value || 0;
        b.count++;
      }
      return Object.entries(buckets)
        .map(([name, { value, count }]) => ({
          name,
          value: Math.round(value * 100) / 100,
          weight: total ? Math.round(value / total * 1000) / 10 : 0,
          count,
        }))
        .sort((a, b) => b.value - a.value);
    }),

    selectedGroupPositions: computed(() => {
      const group = selectedGroup();
      const key = groupBy();
      if (group === 'All') return positions();
      return positions().filter(p => (p[key] as string) === group);
    }),

    isJobRunning: computed(() => {
      const job = activeJob();
      return job !== null && (job.status === 'queued' || job.status === 'running');
    }),
  })),

  // ── Methods ─────────────────────────────────────────────────────────────────
  withMethods((store, api = inject(PortfolioApiClient)) => ({

    // ── Navigation ─────────────────────────────────────────────────────────
    setView(view: ViewName): void {
      patchState(store, { previousView: store.activeView(), activeView: view });
    },

    goBack(): void {
      patchState(store, { activeView: store.previousView() });
    },

    // ── Filter / sort ───────────────────────────────────────────────────────
    setFilter(partial: Partial<HoldingsFilter>): void {
      patchState(store, { filter: { ...store.filter(), ...partial } });
    },

    setGroupBy(key: GroupByKey): void {
      const firstGroup = store.groupedRows()[0]?.name ?? 'All';
      patchState(store, { groupBy: key, selectedGroup: firstGroup });
    },

    setSelectedGroup(group: string): void {
      patchState(store, { selectedGroup: group });
    },

    setSort(key: keyof Position): void {
      const current = store.sortBy();
      if (current === key) {
        patchState(store, {
          sortDirection: store.sortDirection() === 'asc' ? 'desc' : 'asc',
        });
      } else {
        patchState(store, { sortBy: key, sortDirection: 'desc' });
      }
    },

    selectPosition(p: Position | null): void {
      patchState(store, { selectedPosition: p });
    },

    // ── Data loading ────────────────────────────────────────────────────────
    loadPortfolios: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { portfoliosLoading: true })),
        switchMap(() =>
          api.listPortfolios().pipe(
            tap(portfolios => {
              const active = portfolios[0]?.id ?? null;
              patchState(store, { portfolios, activePortfolioId: active, portfoliosLoading: false });
            }),
            catchError(() => { patchState(store, { portfoliosLoading: false }); return EMPTY; }),
          ),
        ),
      ),
    ),

    loadPositions: rxMethod<{ portfolioId: string; live?: boolean }>(
      pipe(
        tap(() => patchState(store, { positionsLoading: true })),
        switchMap(({ portfolioId, live = false }) =>
          api.getPositions(portfolioId, live).pipe(
            tap(positions => patchState(store, { positions, positionsLoading: false })),
            catchError(() => { patchState(store, { positionsLoading: false }); return EMPTY; }),
          ),
        ),
      ),
    ),

    loadSummary: rxMethod<{ portfolioId: string; live?: boolean }>(
      pipe(
        tap(() => patchState(store, { summaryLoading: true })),
        switchMap(({ portfolioId, live = false }) =>
          api.getSummary(portfolioId, live).pipe(
            tap(summary => patchState(store, { summary, summaryLoading: false })),
            catchError(() => { patchState(store, { summaryLoading: false }); return EMPTY; }),
          ),
        ),
      ),
    ),

    loadExposure: rxMethod<{ portfolioId: string }>(
      pipe(
        tap(() => patchState(store, { exposureLoading: true })),
        switchMap(({ portfolioId }) =>
          api.getTrueExposure(portfolioId).pipe(
            tap(exposure => patchState(store, { exposure, exposureLoading: false, exposureLoaded: true })),
            catchError(() => { patchState(store, { exposureLoading: false }); return EMPTY; }),
          ),
        ),
      ),
    ),

    // ── Job polling (polls every 2 seconds until complete) ──────────────────
    pollJob: rxMethod<string>(
      pipe(
        switchMap(jobId =>
          interval(2000).pipe(
            switchMap(() => api.getJobStatus(jobId)),
            tap(job => {
              patchState(store, { activeJob: job });
              if (job.status === 'complete' || job.status === 'error') {
                patchState(store, { activeJobId: null, refreshing: false });
              }
            }),
            catchError(() => EMPTY),
          ),
        ),
      ),
    ),

    setActiveJob(jobId: string): void {
      patchState(store, { activeJobId: jobId, refreshing: true });
    },
  })),
);
