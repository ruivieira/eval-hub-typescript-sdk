/** EvalHub API types used by the client. */

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "partially_failed";

export interface ResourceMetadata {
  id: string;
  tenant?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  owner?: string | null;
}

export interface PrimaryScore {
  metric: string;
  lower_is_better?: boolean;
}

export interface PassCriteria {
  threshold: number;
}

export interface Benchmark {
  id: string;
  url?: string | null;
  name: string;
  description?: string | null;
  category: string;
  metrics?: string[];
  num_few_shot?: number;
  dataset_size?: number;
  tags?: string[];
  primary_score?: PrimaryScore | null;
  pass_criteria?: PassCriteria | null;
  agent?:
    | { result_interpretation?: string | null; score_ranges?: unknown[] }
    | null;
}

export interface AgentMetadata {
  evaluates?: string[];
  recommended_when?: string[];
  target_type?: string | null;
  summary?: string | null;
  complements?: string[];
  hints?: string[];
  result_interpretation?: string[];
}

export interface Provider {
  resource: ResourceMetadata;
  name: string;
  title?: string;
  description?: string | null;
  tags?: string[];
  runtime?: JsonObject | null;
  benchmarks?: Benchmark[];
  agent?: AgentMetadata | null;
}

export interface BenchmarkReference {
  id: string;
  provider_id: string;
  weight?: number;
  parameters?: JsonObject;
  primary_score?: PrimaryScore | null;
  pass_criteria?: PassCriteria | null;
}

export interface Collection {
  resource: ResourceMetadata;
  name: string;
  description?: string;
  category: string;
  tags?: string[];
  custom?: JsonObject;
  benchmarks?: BenchmarkReference[];
  pass_criteria?: PassCriteria | null;
}

export interface ModelConfig {
  url?: string;
  name: string;
  auth?: { secret_ref: string } | null;
}

export interface BenchmarkConfig {
  id: string;
  provider_id: string;
  parameters?: JsonObject;
  primary_score?: PrimaryScore;
  pass_criteria?: PassCriteria;
  test_data_ref?: JsonObject;
}

export interface CollectionRef {
  id: string;
  benchmarks?: BenchmarkConfig[];
}

export interface JobSubmissionRequest {
  name: string;
  description?: string;
  tags?: string[];
  model: ModelConfig;
  benchmarks?: BenchmarkConfig[];
  collection?: CollectionRef;
  experiment?: JsonObject;
  exports?: JsonObject;
  queue?: JsonObject;
}

export interface EvaluationJob {
  resource: ResourceMetadata;
  status?: {
    state: JobStatus;
    message?: unknown;
    benchmarks?: Array<
      {
        id: string;
        provider_id: string;
        status: JobStatus;
        [key: string]: unknown;
      }
    >;
  } | null;
  results?: unknown;
  name: string;
  description?: string | null;
  tags?: string[];
  model: ModelConfig;
  benchmarks?: BenchmarkConfig[] | null;
  collection?: CollectionRef | null;
  [key: string]: unknown;
}

export interface PaginatedResponse<T> {
  total_count: number;
  items: T[] | null;
  [key: string]: unknown;
}

export interface JobListOptions {
  status?: JobStatus;
  limit?: number;
  tenant?: string;
}

export interface RequestOptions {
  /** Override the client's default tenant for this request. */
  tenant?: string;
  /** Abort this request. */
  signal?: AbortSignal;
}
