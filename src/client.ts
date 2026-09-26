import type {
  Benchmark,
  Collection,
  EvaluationJob,
  JobListOptions,
  JobStatus,
  JobSubmissionRequest,
  PaginatedResponse,
  Provider,
  RequestOptions,
} from "./types.ts";

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface EvalHubClientOptions {
  baseUrl?: string;
  authToken?: string;
  tenant?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryInitialDelayMs?: number;
  retryMaxDelayMs?: number;
  retryBackoffFactor?: number;
  retryRandomization?: boolean;
  /** HTTP methods eligible for automatic retry. Defaults to GET, HEAD, and OPTIONS. */
  retryMethods?: readonly string[];
  /** Inject Fetch for tests or custom transports; defaults to the runtime's global fetch. */
  fetch?: FetchFunction;
}

export interface ListProviderOptions extends RequestOptions {
  targetType?: string;
  evaluates?: string;
}

export interface ListBenchmarkOptions extends RequestOptions {
  providerId?: string;
  category?: string;
  limit?: number;
}

export class EvalHubHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly responseBody: string;

  constructor(status: number, url: string, responseBody: string) {
    super(`EvalHub request failed with HTTP ${status}: ${url}`);
    this.name = "EvalHubHttpError";
    this.status = status;
    this.url = url;
    this.responseBody = responseBody;
  }
}

export class JobNotFoundError extends Error {
  readonly jobId: string;

  constructor(jobId: string, options?: ErrorOptions) {
    super(`Job '${jobId}' not found`, options);
    this.name = "JobNotFoundError";
    this.jobId = jobId;
  }
}

export class JobCannotBeCancelledError extends Error {
  readonly jobId: string;

  constructor(jobId: string, reason?: string, options?: ErrorOptions) {
    super(
      `Job '${jobId}' cannot be cancelled${reason ? `: ${reason}` : ""}`,
      options,
    );
    this.name = "JobCannotBeCancelledError";
    this.jobId = jobId;
  }
}

interface RequestConfig extends RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

/** Async-only, Fetch-based EvalHub REST client. No runtime-specific APIs are used. */
export class EvalHubClient {
  readonly baseUrl: string;
  readonly apiBase: string;
  readonly providers: ProvidersResource;
  readonly benchmarks: BenchmarksResource;
  readonly collections: CollectionsResource;
  readonly jobs: JobsResource;

  private readonly token?: string;
  private readonly tenant?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryInitialDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly retryBackoffFactor: number;
  private readonly retryRandomization: boolean;
  private readonly retryMethods: ReadonlySet<string>;
  private readonly fetchImpl: FetchFunction;

  constructor(options: EvalHubClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:8080").replace(
      /\/+$/,
      "",
    );
    this.apiBase = `${this.baseUrl}/api/v1`;
    this.token = options.authToken;
    this.tenant = options.tenant;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryInitialDelayMs = options.retryInitialDelayMs ?? 1_000;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 60_000;
    this.retryBackoffFactor = options.retryBackoffFactor ?? 2;
    this.retryRandomization = options.retryRandomization ?? true;
    this.retryMethods = new Set(
      (options.retryMethods ?? ["GET", "HEAD", "OPTIONS"]).map((method) =>
        method.toUpperCase()
      ),
    );
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (!this.fetchImpl) throw new Error("This runtime does not provide fetch");
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) {
      throw new RangeError("maxRetries must be a non-negative integer");
    }

    this.providers = new ProvidersResource(this);
    this.benchmarks = new BenchmarksResource(this);
    this.collections = new CollectionsResource(this);
    this.jobs = new JobsResource(this);
  }

  /** Check the EvalHub service health endpoint. */
  health(options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.request("/health", options);
  }

  /** Make an API request. Exposed for the resource classes and advanced use. */
  async request<T>(path: string, config: RequestConfig = {}): Promise<T> {
    const url = new URL(`${this.apiBase}${path}`);
    for (const [key, value] of Object.entries(config.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers = new Headers({ Accept: "application/json" });
    if (config.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    const tenant = config.tenant ?? this.tenant;
    if (tenant) headers.set("X-Tenant", tenant);

    const method = (config.method ?? "GET").toUpperCase();
    const canRetry = this.retryMethods.has(method);
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(config.signal?.reason);
      if (config.signal?.aborted) onAbort();
      else config.signal?.addEventListener("abort", onAbort, { once: true });
      const timeout = setTimeout(
        () =>
          controller.abort(
            new DOMException("Request timed out", "TimeoutError"),
          ),
        this.timeoutMs,
      );

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          signal: controller.signal,
          ...(config.body === undefined
            ? {}
            : { body: JSON.stringify(config.body) }),
        });
        if (!response.ok) {
          throw new EvalHubHttpError(
            response.status,
            url.toString(),
            await response.text(),
          );
        }
        if (response.status === 204) return undefined as T;
        return await response.json() as T;
      } catch (error) {
        if (config.signal?.aborted) throw error;
        if (error instanceof EvalHubHttpError) {
          if (error.status < 500 || !canRetry || attempt === this.maxRetries) {
            throw error;
          }
        } else if (!canRetry || attempt === this.maxRetries) {
          throw error;
        }
        lastError = error;
      } finally {
        clearTimeout(timeout);
        config.signal?.removeEventListener("abort", onAbort);
      }

      await delay(this.retryDelay(attempt), config.signal);
    }
    throw lastError;
  }

  private retryDelay(attempt: number): number {
    const delayMs = Math.min(
      this.retryInitialDelayMs * this.retryBackoffFactor ** attempt,
      this.retryMaxDelayMs,
    );
    return this.retryRandomization
      ? delayMs * (0.5 + Math.random() * 0.5)
      : delayMs;
  }
}

class ProvidersResource {
  private readonly client: EvalHubClient;

  constructor(client: EvalHubClient) {
    this.client = client;
  }

  async list(options: ListProviderOptions = {}): Promise<Provider[]> {
    const response = await this.client.request<PaginatedResponse<Provider>>(
      "/evaluations/providers",
      { tenant: options.tenant, signal: options.signal },
    );
    let providers = response.items ?? [];
    if (options.targetType) {
      providers = providers.filter((provider) =>
        provider.agent?.target_type === options.targetType
      );
    }
    if (options.evaluates) {
      providers = providers.filter((provider) =>
        provider.agent?.evaluates?.includes(options.evaluates!)
      );
    }
    return providers;
  }

  get(providerId: string, options: RequestOptions = {}): Promise<Provider> {
    return this.client.request(
      `/evaluations/providers/${encodeURIComponent(providerId)}`,
      options,
    );
  }

  create(
    data: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<Provider> {
    return this.client.request("/evaluations/providers", {
      ...options,
      method: "POST",
      body: data,
    });
  }

  update(
    providerId: string,
    data: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<Provider> {
    return this.client.request(
      `/evaluations/providers/${encodeURIComponent(providerId)}`,
      {
        ...options,
        method: "PUT",
        body: data,
      },
    );
  }

  patch(
    providerId: string,
    data: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<Provider> {
    return this.client.request(
      `/evaluations/providers/${encodeURIComponent(providerId)}`,
      {
        ...options,
        method: "PATCH",
        body: data,
      },
    );
  }

  async delete(
    providerId: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.client.request(
      `/evaluations/providers/${encodeURIComponent(providerId)}`,
      {
        ...options,
        method: "DELETE",
      },
    );
  }
}

class BenchmarksResource {
  private readonly client: EvalHubClient;

  constructor(client: EvalHubClient) {
    this.client = client;
  }

  async list(options: ListBenchmarkOptions = {}): Promise<Benchmark[]> {
    const response = await this.client.request<PaginatedResponse<Provider>>(
      "/evaluations/providers",
      { tenant: options.tenant, signal: options.signal },
    );
    const benchmarks: Benchmark[] = [];
    for (const provider of response.items ?? []) {
      if (options.providerId && provider.resource.id !== options.providerId) {
        continue;
      }
      for (const benchmark of provider.benchmarks ?? []) {
        if (options.category && benchmark.category !== options.category) {
          continue;
        }
        benchmarks.push(benchmark);
      }
    }
    return options.limit ? benchmarks.slice(0, options.limit) : benchmarks;
  }
}

class CollectionsResource {
  private readonly client: EvalHubClient;

  constructor(client: EvalHubClient) {
    this.client = client;
  }

  async list(options: RequestOptions = {}): Promise<Collection[]> {
    const response = await this.client.request<PaginatedResponse<Collection>>(
      "/evaluations/collections",
      options,
    );
    return response.items ?? [];
  }

  get(collectionId: string, options: RequestOptions = {}): Promise<Collection> {
    return this.client.request(
      `/evaluations/collections/${encodeURIComponent(collectionId)}`,
      options,
    );
  }

  create(
    data: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<Collection> {
    return this.client.request("/evaluations/collections", {
      ...options,
      method: "POST",
      body: data,
    });
  }

  update(
    collectionId: string,
    data: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<Collection> {
    return this.client.request(
      `/evaluations/collections/${encodeURIComponent(collectionId)}`,
      {
        ...options,
        method: "PUT",
        body: data,
      },
    );
  }

  patch(
    collectionId: string,
    data: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<Collection> {
    return this.client.request(
      `/evaluations/collections/${encodeURIComponent(collectionId)}`,
      {
        ...options,
        method: "PATCH",
        body: data,
      },
    );
  }

  async delete(
    collectionId: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.client.request(
      `/evaluations/collections/${encodeURIComponent(collectionId)}`,
      {
        ...options,
        method: "DELETE",
      },
    );
  }
}

class JobsResource {
  private readonly client: EvalHubClient;

  constructor(client: EvalHubClient) {
    this.client = client;
  }

  submit(
    request: JobSubmissionRequest,
    options: RequestOptions = {},
  ): Promise<EvaluationJob> {
    return this.client.request("/evaluations/jobs", {
      ...options,
      method: "POST",
      body: request,
    });
  }

  get(jobId: string, options: RequestOptions = {}): Promise<EvaluationJob> {
    return this.client.request(
      `/evaluations/jobs/${encodeURIComponent(jobId)}`,
      options,
    );
  }

  async list(
    options: JobListOptions & { signal?: AbortSignal } = {},
  ): Promise<EvaluationJob[]> {
    const response = await this.client.request<
      PaginatedResponse<EvaluationJob>
    >(
      "/evaluations/jobs",
      {
        tenant: options.tenant,
        signal: options.signal,
        query: { status: options.status, limit: options.limit },
      },
    );
    return response.items ?? [];
  }

  async cancel(
    jobId: string,
    hardDelete = false,
    options: RequestOptions = {},
  ): Promise<boolean> {
    try {
      await this.client.request(
        `/evaluations/jobs/${encodeURIComponent(jobId)}`,
        {
          ...options,
          method: "DELETE",
          query: hardDelete ? { hard_delete: "true" } : undefined,
        },
      );
      return true;
    } catch (error) {
      if (error instanceof EvalHubHttpError && error.status === 404) {
        throw new JobNotFoundError(jobId, { cause: error });
      }
      if (
        error instanceof EvalHubHttpError && [400, 409].includes(error.status)
      ) {
        let reason: string | undefined;
        try {
          reason =
            (JSON.parse(error.responseBody) as { message?: string }).message;
        } catch {
          // Keep the server's error as the cause when it has no JSON message.
        }
        throw new JobCannotBeCancelledError(jobId, reason, { cause: error });
      }
      throw error;
    }
  }

  async waitForCompletion(
    jobId: string,
    options: RequestOptions & { timeoutMs?: number; pollIntervalMs?: number } =
      {},
  ): Promise<EvaluationJob> {
    const startedAt = Date.now();
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    while (true) {
      const job = await this.get(jobId, options);
      if (isTerminal(job)) return job;
      if (
        options.timeoutMs !== undefined &&
        Date.now() - startedAt > options.timeoutMs
      ) {
        throw new DOMException(
          `Job ${jobId} did not complete in time`,
          "TimeoutError",
        );
      }
      await delay(pollIntervalMs, options.signal);
    }
  }
}

function isTerminal(job: EvaluationJob): boolean {
  const terminal = new Set<JobStatus>([
    "completed",
    "failed",
    "cancelled",
    "partially_failed",
  ]);
  const state = job.status?.state ?? "pending";
  if (terminal.has(state)) return true;
  const benchmarks = job.status?.benchmarks;
  if (
    !benchmarks?.length ||
    !benchmarks.every((item) => terminal.has(item.status))
  ) return false;
  const failed = benchmarks.some((item) => item.status === "failed");
  const cancelled = benchmarks.some((item) => item.status === "cancelled");
  const completed = benchmarks.some((item) => item.status === "completed");
  return failed || cancelled || completed;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
