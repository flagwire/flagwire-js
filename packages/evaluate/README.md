# `@flagwire/evaluate`

Deterministic local evaluation engine used by FlagWire server SDKs. It includes the compatibility
fixtures that keep implementations in different languages behaviorally identical.

## Install

```sh
pnpm add @flagwire/evaluate
```

## Usage

```ts
import { evaluateFlag } from "@flagwire/evaluate";

const detail = evaluateFlag(
  bundle,
  "checkout-redesign",
  { key: "user-123", attributes: { region: "eu-west" } },
  false,
);
```

The package exports deterministic hashing, bucket calculation, single-flag evaluation, bundle
evaluation, and their TypeScript types. Inputs use the contracts from `@flagwire/schema`.

## Compatibility vectors

Published vectors are immutable protocol history and are available through the
`@flagwire/evaluate/vectors/*` export. When behavior is extended, add a new vector file instead of
editing an existing one. This lets every SDK implementation verify the same edge cases without
depending on implementation details.
