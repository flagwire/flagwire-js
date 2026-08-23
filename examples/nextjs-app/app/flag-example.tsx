"use client";

import { createClient, type FlagClient } from "@flagwire/sdk-js";
import { FlagProvider, useFlag } from "@flagwire/sdk-react";
import { useEffect, useState } from "react";

import "./flags.gen";

function CheckoutValue() {
  const enabled = useFlag("example.checkout", false);
  return (
    <section aria-live="polite" className="flag-card">
      <span>example.checkout</span>
      <strong data-testid="flag-value">{enabled ? "on" : "off"}</strong>
    </section>
  );
}

export function FlagExample() {
  const [client, setClient] = useState<FlagClient>();
  const clientKey = process.env.NEXT_PUBLIC_FLAGWIRE_CLIENT_KEY;
  const baseUrl = process.env.NEXT_PUBLIC_FLAGWIRE_EDGE_URL;

  useEffect(() => {
    if (!clientKey) return;
    const next = createClient({
      baseUrl,
      clientKey,
      context: { key: "example-user", attributes: { plan: "pro" } },
      stream: true,
    });
    setClient(next);
    return () => next.close();
  }, [baseUrl, clientKey]);

  if (!clientKey) {
    return <p className="setup">Set NEXT_PUBLIC_FLAGWIRE_CLIENT_KEY to run this example.</p>;
  }
  if (!client) return <p className="setup">Connecting to FlagWire…</p>;
  return (
    <FlagProvider client={client} fallback={<p className="setup">Loading flags…</p>} waitForReady>
      <CheckoutValue />
    </FlagProvider>
  );
}
