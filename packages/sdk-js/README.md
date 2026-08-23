# `@flagwire/sdk-js`

Zero-dependency browser SDK for FlagWire. Flag rules remain at the edge; the browser receives only
evaluated values.

```ts
import { createClient } from "@flagwire/sdk-js";

const flags = createClient({
  clientKey: process.env.NEXT_PUBLIC_FLAGWIRE_CLIENT_KEY!,
  context: { key: "user-123", attributes: { plan: "pro" } },
});

await flags.ready();
const enabled = flags.get("checkout-redesign", false);
```

Call `flags.close()` when the client is no longer needed. The SDK polls safely when streaming is
unavailable and validates persisted warm-cache data before use.
