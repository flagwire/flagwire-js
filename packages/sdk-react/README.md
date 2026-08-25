# `@flagwire/sdk-react`

React provider and hooks for [`@flagwire/sdk-js`](../sdk-js).

## Install

```sh
pnpm add @flagwire/sdk-js @flagwire/sdk-react
```

## Usage

```tsx
import { createClient } from "@flagwire/sdk-js";
import { FlagProvider, useFlag } from "@flagwire/sdk-react";

const client = createClient({
  clientKey: import.meta.env.VITE_FLAGWIRE_CLIENT_KEY,
  context: { key: "user-123" },
  activation: "visible",
});

function Checkout() {
  const redesigned = useFlag("checkout-redesign", false);
  return redesigned ? <NewCheckout /> : <LegacyCheckout />;
}

export function App() {
  return (
    <FlagProvider client={client} waitForReady fallback={<AppSkeleton />}>
      <Checkout />
    </FlagProvider>
  );
}
```

Create one browser client for the application lifecycle and call `client.close()` when that
lifecycle ends. In SSR frameworks, create the client in browser-only code after hydration.

## API

- `<FlagProvider client={client}>` makes a browser client available to descendants.
- `waitForReady` delays children until initialization settles. It defaults to `false`, allowing
  components to render immediately with their code defaults.
- `fallback` is rendered while a provider configured with `waitForReady` is initializing.
- `useFlag(key, defaultValue)` returns a value and re-renders only when that flag changes.
- `useFlagClient()` returns the current client for context changes or detailed evaluation data.

`useFlag` always requires a default value. Initialization and refresh failures therefore preserve
the application's declared behavior.
