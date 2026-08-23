# FlagWire JavaScript SDKs

The official MIT-licensed JavaScript and TypeScript SDKs for
[FlagWire](https://flagwire.dev), an edge-native feature flag service.

## Packages

| Package               | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `@flagwire/sdk-js`    | Zero-dependency browser SDK with remote evaluation              |
| `@flagwire/sdk-react` | React provider and hooks for the browser SDK                    |
| `@flagwire/sdk-node`  | Node.js SDK with local evaluation, polling, and streaming       |
| `flagwire-typegen`    | CLI for generating typed flag declarations                      |
| `@flagwire/evaluate`  | Deterministic local evaluation engine and compatibility vectors |
| `@flagwire/schema`    | Public FlagWire wire contracts and schemas                      |

## Development

Use Node.js 24 and pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm --filter @flagwire/example-nextjs exec playwright install chromium
pnpm check
```

The golden evaluation vectors are append-only. Add new vectors for new behavior; never rewrite
published compatibility history.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) to send a
private report.

## License

MIT © FlagWire contributors.
