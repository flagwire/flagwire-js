# Next.js example

Minimal Next.js application showing `@flagwire/sdk-js` lifecycle management and
`@flagwire/sdk-react` hooks.

```sh
NEXT_PUBLIC_FLAGWIRE_CLIENT_KEY=pk_live_... pnpm dev
```

Set `NEXT_PUBLIC_FLAGWIRE_EDGE_URL` only when testing against a local or self-hosted edge endpoint.
The example creates the client in a client component, waits for initial readiness, reacts to
updates, and closes the client during cleanup.

Use only a `pk_live_` browser key in `NEXT_PUBLIC_*` variables. Never place a server key in a public
environment variable.
