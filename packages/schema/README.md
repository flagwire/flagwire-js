# `@flagwire/schema`

Runtime schemas and TypeScript types for FlagWire wire contracts. SDKs use these Zod schemas to
reject malformed payloads before they can become active evaluation state.

## Install

```sh
pnpm add @flagwire/schema
```

## Usage

```ts
import { bundleSchema, type Bundle } from "@flagwire/schema";

const result = bundleSchema.safeParse(input);
if (!result.success) {
  // Keep the last valid bundle or use application defaults.
  return;
}

const bundle: Bundle = result.data;
```

The exported schemas define the protocol boundary shared by the SDKs and edge API. Parse untrusted
input with `safeParse` and avoid activating partially validated data.
