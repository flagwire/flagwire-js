# `@flagwire/evaluate`

Deterministic local evaluation engine shared by FlagWire's server SDKs. The package includes the
append-only compatibility vectors used to keep language implementations behaviorally identical.

```ts
import { evaluateFlag } from "@flagwire/evaluate";
```

Existing vector files are immutable compatibility history. Add a new vector file for every new
edge case.
