# `flagwire-typegen`

Generate TypeScript declarations for FlagWire keys and value types.

## Run

```sh
FLAGWIRE_SERVER_KEY=sk_live_... \
  pnpm dlx flagwire-typegen --out src/flags.gen.ts
```

Import the generated file once from your application entry point:

```ts
import "./flags.gen";
```

Calls to `@flagwire/sdk-js` and `@flagwire/sdk-node` then infer known flag keys and their value
types through TypeScript module augmentation.

## Options

| Option         | Required | Default                    | Description                           |
| -------------- | -------- | -------------------------- | ------------------------------------- |
| `--out`        | yes      | —                          | Generated TypeScript file             |
| `--key`        | no       | `FLAGWIRE_SERVER_KEY`      | Server key used to fetch the manifest |
| `--project`    | no       | key's project              | Explicit project identifier           |
| `--base-url`   | no       | `https://api.flagwire.dev` | Manifest API endpoint                 |
| `--help`, `-h` | no       | —                          | Print command usage                   |

Prefer `FLAGWIRE_SERVER_KEY` over a command-line key so the secret does not appear in shell history
or process listings. The CLI validates the manifest, rejects responses larger than 1 MiB, and
writes the generated file atomically. Never commit a server key.
