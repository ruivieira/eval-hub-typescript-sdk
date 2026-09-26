import { EvalHubClient } from "../src/mod.ts";

const client = new EvalHubClient({
  baseUrl: Bun.env.EVALHUB_URL ?? "http://localhost:8080",
  authToken: Bun.env.EVALHUB_TOKEN,
  tenant: Bun.env.EVALHUB_TENANT,
});

const health = await client.health();
console.log("EvalHub health:", health);

const providers = await client.providers.list();
console.log(`Found ${providers.length} providers`);
