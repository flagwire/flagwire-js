# `@flagwire/schema`

Public Zod schemas and TypeScript types for FlagWire wire contracts. SDKs use these schemas to
reject malformed bundles and fail safely to application defaults.

```ts
import { bundleSchema, type Bundle } from "@flagwire/schema";

const result = bundleSchema.safeParse(input);
```
