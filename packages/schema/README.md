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

Evaluation contexts are limited to one key plus 64 attributes. Attribute names, strings, and
string-array members are bounded by the exported schema. Browser keys use exact allowed origins:
HTTPS for deployed applications, with explicitly configured HTTP localhost origins available for
development. Wildcard origins are rejected.

Release-control contracts include normalized flag metadata, optimistic shared drafts, idempotent
publish requests, and delivery-aware type-generation manifests. Existing flag definitions and
legacy typegen manifests remain valid; missing delivery scope is interpreted as `both` while
deployments migrate.
