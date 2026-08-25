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

| Option             | Required | Default                     | Description                                                                      |
| ------------------ | -------- | --------------------------- | -------------------------------------------------------------------------------- |
| `clientKey`        | yes      | —                           | Public browser key beginning with `pk_live_`                                     |
| `context`          | yes      | —                           | Evaluation key and up to 64 bounded attributes                                   |
| `activation`       | no       | `"visible"`                 | Start immediately, only when visible, or manually                                |
| `baseUrl`          | no       | `https://edge.flagwire.dev` | FlagWire edge endpoint                                                           |
| `bootstrap`        | no       | —                           | Validated snapshot used immediately and checked against the environment version  |
| `pollIntervalMs`   | no       | `false`                     | Optional visible-only version polling; values below 30 seconds are raised to 30s |
| `refreshOnFocus`   | no       | `true`                      | Check the environment version after a stale client regains focus                 |
| `staleAfterMs`     | no       | `300000`                    | Minimum age before a focus check; values below 30 seconds are raised to 30s      |
| `stream`           | no       | `false`                     | Opt in to version notifications; polling slows while the stream is healthy       |
| `exposureTracking` | no       | `"automatic"`               | Deduplicate exposure events, or disable exposure delivery completely             |

## Client API

- `ready()` resolves after the initial snapshot is available, or rejects if the initial request
  fails and no bootstrap or valid warm cache exists.
- `start()` activates a manual client. Repeated calls share the same activation.
- `refresh()` checks the environment version and evaluates only after a change.
- `refresh({ force: true })` deliberately performs a remote evaluation.
- `get(key, defaultValue)` returns the evaluated value or the supplied default.
- `detail(key)` returns the value, variant, reason, and flag version when available.
- `setContext(context)` changes the evaluation context and refreshes the snapshot.
- `on("update", listener)` subscribes to changed flag keys and returns an unsubscribe function.
- `flush()` sends queued exposure events.
- `close()` stops polling and streaming, releases listeners, and attempts a final flush.

The SDK validates network and persisted snapshots before use. A valid warm cache or bootstrap is
available immediately; activation first performs an unmetered version check and only evaluates
when configuration changed. Equivalent contexts are canonicalized, so reordered attributes or
string-array members do not cause a refresh. Always provide a safe code default.

Version probes identify only their lifecycle cause (`activation`, `context`, `focus`, `manual`, or
`poll`) and SDK version for operational diagnostics. They never send evaluation-context values,
user identifiers, email addresses, or page URLs.

## Updating from 0.1

Version 0.2 changes the default lifecycle: activation waits for a visible page and interval polling
is off unless configured. Use `activation: "immediate"` only when startup networking is intentional,
or `activation: "manual"` with `start()` after a trusted application interaction. Streaming remains
opt-in. Cached data now uses a v2 namespace and never stores the raw evaluation context.

An authentication rejection clears every cached snapshot for that client key. A quota response
keeps the last valid snapshot; a cold client continues to use the default passed to `get()`.

## Key safety

`pk_live_` client keys are designed for browser use and only authorize remote evaluation. Never
put a `sk_live_` server key in frontend source, public environment variables, HTML, or client
bundles.

## Type-safe flags

Run [`flagwire-typegen`](../../tools/typegen-cli) and import the generated declaration file once in
your application. `get()` then infers known keys and value types.
