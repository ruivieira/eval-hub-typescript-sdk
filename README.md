# EvalHub TypeScript SDK

[![CI](https://github.com/ruivieira/eval-hub-typescript-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ruivieira/eval-hub-typescript-sdk/actions/workflows/ci.yml)
[![JSR](https://jsr.io/badges/@rui/eval-hub-typescript-sdk)](https://jsr.io/@rui/eval-hub-typescript-sdk)

A runtime-independent, async-only TypeScript client for the EvalHub REST API. It
uses the standard Fetch API and has no runtime dependencies, so the same client
source works in Deno, Node.js, and Bun. This is an early client-focused port of
[`eval-hub-sdk`](https://github.com/eval-hub/eval-hub-sdk); it does not include
the Python SDK's adapter, CLI, or model-validation layers.

## Development with Bun

```sh
bun install
bun run typecheck
bun test
bun run examples/client.ts
```

## Usage

The runnable Bun example in [`examples/client.ts`](examples/client.ts) reads
`EVALHUB_URL`, `EVALHUB_TOKEN`, and `EVALHUB_TENANT` from `Bun.env`, then checks
health and lists providers. Applications can also construct an `EvalHubClient`
directly:

```ts
import * as eval_hub_typescript_sdk from "@rui/eval-hub-typescript-sdk";

const client = new eval_hub_typescript_sdk.EvalHubClient({
  baseUrl: Bun.env.EVALHUB_URL ?? "http://localhost:8080",
  authToken: Bun.env.EVALHUB_TOKEN,
  tenant: Bun.env.EVALHUB_TENANT,
});

const health = await client.health();
console.log("EvalHub health:", health.status);

const providers = await client.providers.list({ targetType: "agent" });
console.log(providers);
```

Pass credentials explicitly; the portable client does not read environment
variables, token files, or Kubernetes service-account mounts. `health()` returns
a typed `HealthResponse`. For custom transports and tests, inject a standard
Fetch-compatible function with the `fetch` option. Request methods also accept
an `AbortSignal`. Set `maxResponseBytes` to enforce an optional response-body
size limit; oversized responses raise `EvalHubResponseTooLargeError`.

Automatic retries default to `GET`, `HEAD`, and `OPTIONS` only, avoiding
accidental duplicate job submissions or other writes after ambiguous failures.
You can opt an additional method into retries with `retryMethods` only when that
operation is safe and idempotent for your API use case.

## Install

Install the JSR package with Bun:

```sh
bunx jsr add @rui/eval-hub-typescript-sdk
```

Import it using its JSR package name, `@rui/eval-hub-typescript-sdk`. For npm-
compatible package managers, JSR also exposes
`@jsr/rui__eval-hub-typescript-sdk` through `https://npm.jsr.io`; configure the
`@jsr` scope to use that registry. The current release is `0.1.1`.

## Releasing

The `Publish to JSR` GitHub Actions workflow publishes on version tags such as
`vX.Y.Z`. It derives the package version from the tag, runs type checks, tests,
formatting, and linting, then publishes using GitHub Actions OIDC. No JSR token
is stored as a GitHub secret.
