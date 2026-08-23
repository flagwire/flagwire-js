"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import type { FlagClient, FlagKey, FlagValue, JsonValue } from "@flagwire/sdk-js";

const ClientContext = createContext<FlagClient | undefined>(undefined);

export interface FlagProviderProps {
  children?: ReactNode;
  client: FlagClient;
  fallback?: ReactNode;
  waitForReady?: boolean;
}

export function FlagProvider({
  children,
  client,
  fallback = null,
  waitForReady = false,
}: FlagProviderProps) {
  const [ready, setReady] = useState(!waitForReady);

  useEffect(() => {
    if (!waitForReady) {
      setReady(true);
      return;
    }
    let active = true;
    void client.ready().then(
      () => active && setReady(true),
      () => active && setReady(true),
    );
    return () => {
      active = false;
    };
  }, [client, waitForReady]);

  return createElement(ClientContext.Provider, { value: client }, ready ? children : fallback);
}

export function useFlagClient(): FlagClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error("useFlagClient must be used inside a FlagProvider");
  return client;
}

export function useFlag<K extends FlagKey, D extends JsonValue>(
  key: K,
  defaultValue: D,
): FlagValue<K, D> {
  const client = useFlagClient();
  const subscribe = (notify: () => void) =>
    client.on("update", (keys) => keys.includes(key) && notify());
  const read = () => client.detail(key);
  const detail = useSyncExternalStore(subscribe, read, read);
  const value = (detail?.value ?? defaultValue) as FlagValue<K, D>;

  useEffect(() => {
    client.get(key, defaultValue);
  }, [client, defaultValue, detail?.flagVersion, detail?.variant, key]);

  return value;
}
