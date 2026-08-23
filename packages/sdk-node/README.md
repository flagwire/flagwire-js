# `@flagwire/sdk-node`

Node.js SDK with deterministic local evaluation. It validates and caches environment bundles,
polls with ETags, and can use streaming notifications for prompt refreshes.

Requires Node.js 22.4 or newer.

## Install

```sh
pnpm add @flagwire/sdk-node
```

## Usage

```ts
import { createServerClient } from "@flagwire/sdk-node";

const flags = createServerClient({
  serverKey: process.env.FLAGWIRE_SERVER_KEY!,
});

await flags.waitForInitialization({ timeoutMs: 5_000 });

const enabled = flags.evaluate(
  "checkout-redesign",
  { key: "user-123", attributes: { region: "eu-west" } },
  false,
);

// During graceful shutdown:
await flags.close();
```

Create one long-lived client per process instead of one per request.

## Options

| Option           | Required | Default                     | Description                                                   |
| ---------------- | -------- | --------------------------- | ------------------------------------------------------------- |
| `serverKey`      | yes      | —                           | Secret server key beginning with `sk_live_`                   |
| `baseUrl`        | no       | `https://edge.flagwire.dev` | FlagWire edge endpoint                                        |
| `pollIntervalMs` | no       | `30000`                     | Refresh interval when a stream is not healthy                 |
| `stream`         | no       | `true`                      | Use version notifications when WebSocket support is available |

## Client API

- `waitForInitialization({ timeoutMs })` waits for the first bundle attempt without blocking the
  process indefinitely.
- `evaluate(key, context, defaultValue)` returns a locally evaluated value or the supplied default.
- `evaluateDetail(key, context, defaultValue)` also returns the evaluation reason and variant.
- `allFlags(context)` evaluates every flag in the active bundle.
- `flush()` sends queued exposure events.
- `close()` stops background work, flushes pending events, and releases the stream.

Bundles are validated before activation. Invalid, unavailable, or revoked bundle state fails
closed to application-provided defaults.

## Key safety

Treat `sk_live_` keys as secrets. Load them from a secret manager or process environment; never
commit, log, or send them to a browser. Use [`@flagwire/sdk-js`](../sdk-js) with a `pk_live_` key for
client-side applications.

## Type-safe flags

Run [`flagwire-typegen`](../../tools/typegen-cli) and import the generated declaration file once in
your application. `evaluate()` then infers known keys and value types.
