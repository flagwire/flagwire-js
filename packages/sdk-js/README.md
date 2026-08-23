# `@flagwire/sdk-js`

Small, framework-agnostic browser SDK for remotely evaluated FlagWire feature flags. Flag rules
stay at the edge; the browser receives evaluated values.

## Install

```sh
pnpm add @flagwire/sdk-js
```

## Usage

```ts
import { createClient } from "@flagwire/sdk-js";

const flags = createClient({
  clientKey: import.meta.env.VITE_FLAGWIRE_CLIENT_KEY,
  context: {
    key: "user-123",
    attributes: { region: "eu-west", betaTester: true },
  },
  stream: true,
});

await flags.ready();

const enabled = flags.get("checkout-redesign", false);
const unsubscribe = flags.on("update", (changedKeys) => {
  if (changedKeys.includes("checkout-redesign")) render();
});

// At the application lifecycle boundary:
unsubscribe();
flags.close();
```

Create the client in browser-only code. For SSR frameworks, create it after hydration or inside a
client component and keep a single instance for the application lifecycle.

## Options

| Option           | Required | Default                     | Description                                                                     |
| ---------------- | -------- | --------------------------- | ------------------------------------------------------------------------------- |
| `clientKey`      | yes      | —                           | Public browser key beginning with `pk_live_`                                    |
| `context`        | yes      | —                           | Evaluation key and optional string, number, boolean, or string-array attributes |
| `baseUrl`        | no       | `https://edge.flagwire.dev` | FlagWire edge endpoint                                                          |
| `bootstrap`      | no       | —                           | Validated snapshot used before the first network refresh                        |
| `pollIntervalMs` | no       | `60000`                     | Background refresh interval                                                     |
| `stream`         | no       | `false`                     | Refresh promptly after version notifications                                    |

## Client API

- `ready()` resolves after the initial snapshot is available, or rejects if the initial request
  fails and no bootstrap or valid warm cache exists.
- `get(key, defaultValue)` returns the evaluated value or the supplied default.
- `detail(key)` returns the value, variant, reason, and flag version when available.
- `setContext(context)` changes the evaluation context and refreshes the snapshot.
- `on("update", listener)` subscribes to changed flag keys and returns an unsubscribe function.
- `flush()` sends queued exposure events.
- `close()` stops polling and streaming, releases listeners, and attempts a final flush.

The SDK validates network and persisted snapshots before use. A valid warm cache can avoid a blank
startup, while stale or malformed data is ignored. Always provide a safe code default.

## Key safety

`pk_live_` client keys are designed for browser use and only authorize remote evaluation. Never
put a `sk_live_` server key in frontend source, public environment variables, HTML, or client
bundles.

## Type-safe flags

Run [`flagwire-typegen`](../../tools/typegen-cli) and import the generated declaration file once in
your application. `get()` then infers known keys and value types.
