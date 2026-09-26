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
import { EvalHubClient } from "@jsr/rui__eval-hub-typescript-sdk";

const client = new EvalHubClient({
  baseUrl: Bun.env.EVALHUB_URL ?? "http://localhost:8080",
  authToken: Bun.env.EVALHUB_TOKEN,
  tenant: Bun.env.EVALHUB_TENANT,
});

const providers = await client.providers.list({ targetType: "agent" });
console.log(providers);
```

Pass credentials explicitly; the portable client does not read environment
variables, token files, or Kubernetes service-account mounts. For custom
transports and tests, inject a standard Fetch-compatible function with the
`fetch` option. Request methods also accept an `AbortSignal`.

Automatic retries default to `GET`, `HEAD`, and `OPTIONS` only, avoiding
accidental duplicate job submissions or other writes after ambiguous failures.
You can opt an additional method into retries with `retryMethods` only when that
operation is safe and idempotent for your API use case.

## Install

Once published, Bun, Node.js, and other npm-compatible runtimes can install the
JSR-generated npm package:

```sh
bun add @jsr/rui__eval-hub-typescript-sdk
```

The JSR package name is `@rui/eval-hub-typescript-sdk`; `@rui` is the same JSR
scope used by White Rabbit. Its npm compatibility name is
`@jsr/rui__eval-hub-typescript-sdk`. This checkout has not been published yet.

## Releasing

The `Publish to JSR` GitHub Actions workflow publishes on version tags such as
`v0.1.0`. It derives the package version from the tag, runs type checks, tests,
formatting, and linting, then publishes using GitHub Actions OIDC. Ensure the
`@rui` JSR scope is associated with this GitHub account/repository before the
first release; no JSR token is stored as a GitHub secret.
