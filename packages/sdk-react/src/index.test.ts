import { createElement } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EvaluationDetail, FlagClient, FlagKey, FlagValue, JsonValue } from "@flagwire/sdk-js";

import { FlagProvider, useFlag } from "./index";

function fakeClient(initial?: EvaluationDetail): {
  client: FlagClient;
  publish(detail: EvaluationDetail): void;
} {
  const listeners = new Set<(keys: string[]) => void>();
  let detail = initial;
  const client: FlagClient = {
    close: vi.fn(),
    detail: () => detail,
    flush: vi.fn(async () => undefined),
    get<K extends FlagKey, D extends JsonValue>(_key: K, defaultValue: D): FlagValue<K, D> {
      return (detail?.value ?? defaultValue) as FlagValue<K, D>;
    },
    on: (_event, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    setContext: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
  };
  return {
    client,
    publish(next) {
      detail = next;
      listeners.forEach((listener) => listener(["checkout"]));
    },
  };
}

function Checkout() {
  return createElement("span", null, useFlag("checkout", false) ? "on" : "off");
}

describe("React bindings", () => {
  it("renders a default and updates only when the selected flag changes", async () => {
    const flags = fakeClient();
    const view = render(
      createElement(FlagProvider, { client: flags.client }, createElement(Checkout)),
    );
    expect(screen.getByText("off")).toBeDefined();

    act(() => {
      flags.publish({ flagVersion: 2, reason: "FALLTHROUGH", value: true, variant: "on" });
    });
    expect(screen.getByText("on")).toBeDefined();
    view.unmount();
  });

  it("supports waitForReady fallback without trapping apps on an initialization error", async () => {
    const flags = fakeClient();
    let rejectReady: ((error: Error) => void) | undefined;
    flags.client.ready = () =>
      new Promise<void>((_resolve, reject) => {
        rejectReady = reject;
      });

    const view = render(
      createElement(
        FlagProvider,
        { client: flags.client, fallback: "loading", waitForReady: true },
        createElement(Checkout),
      ),
    );
    expect(screen.getByText("loading")).toBeDefined();

    await act(async () => rejectReady?.(new Error("offline")));
    expect(screen.getByText("off")).toBeDefined();
    view.unmount();
  });
});
