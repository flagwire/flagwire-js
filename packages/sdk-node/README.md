# `@flagwire/sdk-node`

Node.js SDK for deterministic local FlagWire evaluation. Bundles are fetched with ETags and kept
fresh through polling with optional streaming notifications.

```ts
import { createServerClient } from "@flagwire/sdk-node";

const flags = createServerClient({ serverKey: process.env.FLAGWIRE_SERVER_KEY! });
await flags.waitForInitialization({ timeoutMs: 5_000 });

const enabled = flags.evaluate("checkout-redesign", { key: "user-123" }, false);
```

Call `await flags.close()` during graceful shutdown. Never expose a server key to a browser.
