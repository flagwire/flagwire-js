# `@flagwire/sdk-react`

React provider and hooks for `@flagwire/sdk-js`.

```tsx
import { FlagProvider, useFlag } from "@flagwire/sdk-react";

function Checkout() {
  const redesigned = useFlag("checkout-redesign", false);
  return redesigned ? <NewCheckout /> : <LegacyCheckout />;
}

export function App({ client }: { client: FlagClient }) {
  return (
    <FlagProvider client={client} waitForReady fallback={null}>
      <Checkout />
    </FlagProvider>
  );
}
```

Create the client with `@flagwire/sdk-js` and close it at the application lifecycle boundary.
