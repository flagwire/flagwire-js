# `flagwire-typegen`

Generate TypeScript flag declarations from a FlagWire project.

```sh
npx flagwire-typegen \
  --key "$FLAGWIRE_SERVER_KEY" \
  --out src/flags.gen.ts
```

The key may be supplied through `FLAGWIRE_SERVER_KEY` instead of `--key`. Generated files are
written atomically. Never commit a server key.
