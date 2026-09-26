import { test } from "bun:test";
import {
  EvalHubClient,
  EvalHubHttpError,
  EvalHubResponseTooLargeError,
} from "../src/mod.ts";

function assertEquals<T>(
  actual: T,
  expected: T,
  message = "values differ",
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

async function assertRejects(
  callback: () => Promise<unknown>,
  errorType: new (...args: never[]) => Error,
  message: string,
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    if (!(error instanceof errorType) || !error.message.includes(message)) {
      throw error;
    }
    return;
  }
  throw new Error(`Expected rejection containing '${message}'`);
}

test("client adds auth and tenant headers and normalizes base URL", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  const client = new EvalHubClient({
    baseUrl: "https://evalhub.example.test///",
    authToken: "secret",
    tenant: "team-a",
    fetch: (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ status: "ok" }));
    },
  });

  const result = await client.health();
  assertEquals(requestedUrl, "https://evalhub.example.test/api/v1/health");
  assertEquals(requestedHeaders?.get("authorization"), "Bearer secret");
  assertEquals(requestedHeaders?.get("x-tenant"), "team-a");
  assertEquals(result, { status: "ok" });
});

test("health has a typed response and accepts a bounded response body", async () => {
  const client = new EvalHubClient({
    maxResponseBytes: 32,
    fetch: () => Promise.resolve(Response.json({ status: "healthy" })),
  });

  const health = await client.health();
  assertEquals(health.status, "healthy");
});

test("response size limits apply to successful bodies and do not retry", async () => {
  let calls = 0;
  const client = new EvalHubClient({
    maxRetries: 2,
    maxResponseBytes: 8,
    retryInitialDelayMs: 0,
    fetch: () => {
      calls++;
      return Promise.resolve(Response.json({ status: "healthy" }));
    },
  });

  await assertRejects(
    () => client.health(),
    EvalHubResponseTooLargeError,
    "8-byte",
  );
  assertEquals(calls, 1);
});

test("response size limits apply to error bodies and do not retry", async () => {
  let calls = 0;
  const client = new EvalHubClient({
    maxRetries: 2,
    maxResponseBytes: 4,
    retryInitialDelayMs: 0,
    fetch: () => {
      calls++;
      return Promise.resolve(new Response("error", { status: 503 }));
    },
  });

  await assertRejects(
    () => client.providers.list(),
    EvalHubResponseTooLargeError,
    "4-byte",
  );
  assertEquals(calls, 1);
});

test("response size limit must be a positive safe integer", () => {
  try {
    new EvalHubClient({ maxResponseBytes: 0 });
  } catch (error) {
    if (
      error instanceof RangeError &&
      error.message.includes("positive safe integer")
    ) return;
    throw error;
  }
  throw new Error("Expected maxResponseBytes validation failure");
});

test("request exposes its method options for typed advanced calls", async () => {
  const client = new EvalHubClient({
    maxRetries: 0,
    fetch: (_input, init) => {
      assertEquals(init?.method, "POST");
      return Promise.resolve(new Response("not allowed", { status: 405 }));
    },
  });

  await assertRejects(
    () => client.request("/health", { method: "POST" }),
    EvalHubHttpError,
    "HTTP 405",
  );
});

test("provider list applies client-side filters and supports tenant overrides", async () => {
  let tenantHeader: string | null = null;
  const client = new EvalHubClient({
    fetch: (_input, init) => {
      tenantHeader = new Headers(init?.headers).get("x-tenant");
      return Promise.resolve(Response.json({
        total_count: 2,
        items: [
          {
            resource: { id: "one" },
            name: "one",
            agent: { target_type: "agent", evaluates: ["safety"] },
          },
          {
            resource: { id: "two" },
            name: "two",
            agent: { target_type: "model", evaluates: ["quality"] },
          },
        ],
      }));
    },
  });

  const providers = await client.providers.list({
    targetType: "agent",
    tenant: "override",
  });
  assertEquals(tenantHeader, "override");
  assertEquals(providers.map((provider) => provider.name), ["one"]);
});

test("HTTP 4xx errors are not retried", async () => {
  let calls = 0;
  const client = new EvalHubClient({
    maxRetries: 4,
    fetch: () => {
      calls++;
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  await assertRejects(
    () => client.providers.get("missing"),
    EvalHubHttpError,
    "HTTP 404",
  );
  assertEquals(calls, 1);
});

test("job submission is not repeated after a server error", async () => {
  let calls = 0;
  const client = new EvalHubClient({
    maxRetries: 4,
    retryInitialDelayMs: 0,
    fetch: () => {
      calls++;
      return Promise.resolve(
        new Response("server failed after receiving the request", {
          status: 503,
        }),
      );
    },
  });

  await assertRejects(
    () =>
      client.jobs.submit({
        name: "do-not-duplicate",
        model: { name: "test-model" },
        benchmarks: [{ id: "test", provider_id: "test-provider" }],
      }),
    EvalHubHttpError,
    "HTTP 503",
  );
  assertEquals(calls, 1);
});

test("network failures do not retry non-idempotent requests", async () => {
  let calls = 0;
  const client = new EvalHubClient({
    maxRetries: 4,
    fetch: () => {
      calls++;
      return Promise.reject(new TypeError("connection lost"));
    },
  });

  await assertRejects(
    () =>
      client.jobs.submit({
        name: "do-not-duplicate",
        model: { name: "test-model" },
        benchmarks: [{ id: "test", provider_id: "test-provider" }],
      }),
    TypeError,
    "connection lost",
  );
  assertEquals(calls, 1);
});

test("server errors are retried and a successful response is returned", async () => {
  let calls = 0;
  const client = new EvalHubClient({
    maxRetries: 1,
    retryInitialDelayMs: 0,
    retryRandomization: false,
    fetch: () => {
      calls++;
      return Promise.resolve(
        calls === 1
          ? new Response("temporary", { status: 503 })
          : Response.json({ total_count: 0, items: [] }),
      );
    },
  });

  assertEquals(await client.providers.list(), []);
  assertEquals(calls, 2);
});
