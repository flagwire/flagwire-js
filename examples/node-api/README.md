# Node.js API example

Minimal HTTP service showing long-lived `@flagwire/sdk-node` initialization, per-request local
evaluation, and graceful shutdown.

```sh
FLAGWIRE_SERVER_KEY=sk_live_... pnpm dev
```

The example listens on port `3002` by default. Override it with `PORT` and request
`/checkout?user=user-123` to evaluate the sample flag.

Load the server key from a local environment file or secret manager. Do not commit it or expose it
to browser code.
