# FlagWire JavaScript SDKs

Official MIT-licensed JavaScript and TypeScript tooling for evaluating FlagWire feature flags in
browsers, React applications, and Node.js services.

## Choose a package

| Package                                     | Use it for                                            |
| ------------------------------------------- | ----------------------------------------------------- |
| [`@flagwire/sdk-js`](packages/sdk-js)       | Browser applications and framework-agnostic frontends |
| [`@flagwire/sdk-react`](packages/sdk-react) | React providers and hooks built on the browser SDK    |
| [`@flagwire/sdk-node`](packages/sdk-node)   | Local evaluation in Node.js services                  |
| [`flagwire-typegen`](tools/typegen-cli)     | Generated flag keys and value types                   |
| [`@flagwire/evaluate`](packages/evaluate)   | Deterministic evaluation and compatibility testing    |
| [`@flagwire/schema`](packages/schema)       | Runtime validation for FlagWire wire contracts        |

## Browser quick start

```sh
pnpm add @flagwire/sdk-js
```

```ts
import { createClient } from "@flagwire/sdk-js";

const flags = createClient({
  clientKey: import.meta.env.VITE_FLAGWIRE_CLIENT_KEY,
  context: { key: "user-123", attributes: { region: "eu-west" } },
});

await flags.ready();
const redesigned = flags.get("checkout-redesign", false);
```

Browser clients activate when the page is visible by default. Warm caches and server-provided
bootstrap snapshots are available immediately and use a version check before any new evaluation.
Interval polling and streaming are opt-in.

Always pass a default value. If initialization or refresh fails, evaluation remains predictable and
uses the application-provided default. Browser keys begin with `pk_live_` and are intended for
client-side use; never expose a `sk_live_` server key in browser code.

## Node.js quick start

```sh
pnpm add @flagwire/sdk-node
```

```ts
import { createServerClient } from "@flagwire/sdk-node";

const flags = createServerClient({ serverKey: process.env.FLAGWIRE_SERVER_KEY! });
await flags.waitForInitialization({ timeoutMs: 5_000 });

const redesigned = flags.evaluate("checkout-redesign", { key: "user-123" }, false);
```

Create one long-lived client per process and close it during graceful shutdown. Server keys begin
with `sk_live_`; keep them in a secret manager and out of source control, logs, and client bundles.

## Typed flags

Generate module declarations from the current project manifest:

```sh
FLAGWIRE_SERVER_KEY=sk_live_... \
  pnpm dlx flagwire-typegen --out src/flags.gen.ts
```

Import the generated file once from your application. Both browser and Node SDK calls then infer
known flag keys and their value types.

## Examples

- [`examples/nextjs-app`](examples/nextjs-app) demonstrates browser and React lifecycle handling.
- [`examples/node-api`](examples/node-api) demonstrates local evaluation in a Node.js HTTP server.

## Development

This repository uses Node.js 24 and pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm --filter @flagwire/example-nextjs exec playwright install chromium
pnpm check
```

The evaluation vectors are append-only compatibility fixtures. Add new vectors for new behavior;
never rewrite published compatibility history.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines. To report a vulnerability,
follow the private disclosure process in [SECURITY.md](SECURITY.md).

## License

MIT © FlagWire contributors.
