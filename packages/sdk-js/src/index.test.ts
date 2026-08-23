import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient, type EvalSnapshot } from "./index";

const clientKey = `pk_live_${"a".repeat(43)}`;
const first: EvalSnapshot = {
  version: 1,
  flags: {
    checkout: {
      flagVersion: 3,
      reason: "FALLTHROUGH",
      value: true,
      variant: "on",
    },
  },
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("browser client", () => {
  it("uses bootstrap synchronously and batches exposure counts", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      return url.endsWith("/v1/eval") ? response(first) : new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ clientKey, context: { key: "user-1" }, bootstrap: first });

    await client.ready();
    expect(client.get("checkout", false)).toBe(true);
    expect(client.get("checkout", false)).toBe(true);
    await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const eventsCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/v1/events"));
    const init = eventsCall?.[1];
    if (!init) throw new Error("Missing event request");
    expect(JSON.parse(String(init.body))).toEqual([
      { count: 2, flagKey: "checkout", flagVersion: 3, variant: "on" },
    ]);
    client.close();
  });

  it("deduplicates concurrent refreshes and emits only changed keys", async () => {
    const second: EvalSnapshot = {
      version: 2,
      flags: { checkout: { ...first.flags.checkout!, value: false, variant: "off" } },
    };
    const fetchMock = vi.fn().mockResolvedValue(response(second));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ clientKey, context: { key: "user-1" }, bootstrap: first });
    const listener = vi.fn();
    client.on("update", listener);

    await Promise.all([client.setContext({ key: "user-2" }), client.setContext({ key: "user-2" })]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.get("checkout", true)).toBe(false);
    expect(listener).toHaveBeenCalledWith(["checkout"]);
    client.close();
  });

  it("rejects server keys and preserves code defaults when initialization fails", async () => {
    expect(() =>
      createClient({ clientKey: `sk_live_${"a".repeat(43)}`, context: { key: "user" } }),
    ).toThrow(/client key/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: true }, 503)));
    const client = createClient({ clientKey, context: { key: "user" } });
    await expect(client.ready()).rejects.toThrow("HTTP 503");
    expect(client.get("missing", false)).toBe(false);
    client.close();
  });

  it("never applies snapshots older than the current version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...first, version: 0 })));
    const client = createClient({
      clientKey,
      context: { key: "user" },
      bootstrap: { ...first, version: 2 },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.get("checkout", false)).toBe(true);
    client.close();
  });

  it("discards a response when the context changes before it resolves", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(
        response({
          ...first,
          version: 2,
          flags: { checkout: { ...first.flags.checkout!, value: false, variant: "off" } },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ clientKey, context: { key: "user-1" } });

    const latest = client.setContext({ key: "user-2" });
    resolveFirst?.(response(first));
    await latest;

    expect(client.get("checkout", true)).toBe(false);
    client.close();
  });

  it("clears a warm snapshot when the client key is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: true }, 401)));
    const client = createClient({ clientKey, context: { key: "user" }, bootstrap: first });
    await vi.advanceTimersByTimeAsync(0);

    expect(client.get("checkout", false)).toBe(false);
    expect(localStorage.removeItem).toHaveBeenCalled();
    client.close();
  });
});
