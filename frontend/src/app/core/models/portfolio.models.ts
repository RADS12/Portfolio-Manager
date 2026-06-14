// src/app/core/models/portfolio.models.ts
// ─────────────────────────────────────────
// All TypeScript interfaces matching the FastAPI Pydantic schemas exactly.
// These are the single source of truth for types across the Angular app.

export interface User {
  id: string;
  email: string;
  plan: 'free' | 'pro' | 'enterprise';
  created_at: string;
}

export interface TokenResponse {
  message: string;
  user: User;
}

export interface Portfolio {
  id: string;
  name: string;
  currency: string;
  created_at: string;
  updated_at: string;
  position_count: number;
  total_value: number;
}

export interface Position {
  symbol: string;
  name: string | null;
  quantity: number | null;
  last_price: number | null;
  csv_price: number | null;
  current_value: number | null;
  csv_value: number | null;
  asset_type: string | null;
  sector: string | null;
  industry: string | null;
  theme: string | null;
  region: string | null;
  risk_bucket: string | null;
  weight: number;
  price_source: string;
  top_holdings: TopHolding[];
  top_holdings_source: string;
}

export interface TopHolding {
  symbol: string;
  name: string;
  weight: number;
  source: string;
}

export interface AllocationItem {
  name: string;
  value: number;
  weight: number;
  count: number;
}

export interface MarketDataInfo {
  pricing_mode: string;
  live_priced_positions: number;
  total_positions: number;
  last_refresh_utc: string | null;
}

export interface Summary {
  total_value: number;
  position_count: number;
  cash_value: number;
  cash_weight: number;
  top10_value: number;
  top10_weight: number;
  largest_holding: Position | null;
  sector_allocation: AllocationItem[];
  theme_allocation: AllocationItem[];
  industry_allocation: AllocationItem[];
  region_allocation: AllocationItem[];
  asset_type_allocation: AllocationItem[];
  risk_allocation: AllocationItem[];
  market_data: MarketDataInfo;
}

export interface TreemapGroup {
  name: string;
  value: number;
  weight: number;
  children: Position[];
}

export interface TrueExposureItem {
  symbol: string;
  name: string;
  value: number;
  weight: number;
  source_count: number;
  is_major: boolean;
  sector: string | null;
  industry: string | null;
  theme: string | null;
  region: string | null;
  sources: ExposureSource[];
}

export interface ExposureSource {
  fund: string;
  fund_name: string;
  fund_weight: number;
  holding_weight: number;
  value: number;
}

export interface ExposureResponse {
  as_of_utc: string;
  method: string;
  exposures: TrueExposureItem[];
}

export interface JobStatus {
  id: string;
  job_type: string;
  status: 'queued' | 'running' | 'complete' | 'error';
  stage: string | null;
  progress: number;
  message: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface UploadResponse {
  message: string;
  filename: string;
  position_count: number;
  job_id: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  environment: string;
  database: string;
  redis: string;
}

// ── UI-only types ─────────────────────────────────────────────────────────────

export type ViewName =
  | 'dashboard'
  | 'holdings'
  | 'drilldown'
  | 'exposure'
  | 'risk'
  | 'charts'
  | 'onboarding'
  | 'settings';

export type GroupByKey = keyof Pick<
  Position,
  'sector' | 'theme' | 'industry' | 'region' | 'asset_type' | 'risk_bucket'
>;

export type SortDirection = 'asc' | 'desc';

export interface HoldingsFilter {
  search: string;
  asset_type: string;
  sector: string;
  theme: string;
  risk_bucket: string;
  exclude_cash: boolean;
}
