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

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...headers },
    status,
  });
}

function versionResponse(version: number) {
  return jsonResponse({ version }, 200, { ETag: `"v${version}"` });
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    values,
  };
}

class TestSocket extends EventTarget {
  static instances: TestSocket[] = [];
  readonly url: string;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    TestSocket.instances.push(this);
  }

  close() {}

  message(data: string) {
    this.dispatchEvent(Object.assign(new Event("message"), { data }));
  }

  disconnect(code = 1006) {
    this.dispatchEvent(Object.assign(new Event("close"), { code }));
  }
}

let storage: ReturnType<typeof createStorage>;

beforeEach(() => {
  vi.useFakeTimers();
  TestSocket.instances = [];
  storage = createStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("browser client", () => {
  it("probes a bootstrap version and deduplicates automatic exposures", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      return url.endsWith("/v1/version")
        ? new Response(null, { status: 304 })
        : new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ clientKey, context: { key: "user-1" }, bootstrap: first });

    await client.ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.get("checkout", false)).toBe(true);
    expect(client.get("checkout", false)).toBe(true);
    await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-FlagWire-Reason")).toBe(
      "activation",
    );
    const eventsCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/v1/events"));
    const init = eventsCall?.[1];
    if (!init) throw new Error("Missing event request");
    expect(JSON.parse(String(init.body))).toEqual([
      { count: 1, flagKey: "checkout", flagVersion: 3, variant: "on" },
    ]);
    client.close();
  });

  it("keeps manual clients offline until start and makes start idempotent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(first));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({
      activation: "manual",
      clientKey,
      context: { key: "user" },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await Promise.all([client.start(), client.start()]);
    await client.ready();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/v1\/eval$/);
    client.close();
  });

  it("does not activate a visible client while the document is hidden", async () => {
    const listeners = new Map<string, EventListener>();
    const documentMock = {
      visibilityState: "hidden",
      addEventListener: vi.fn((name: string, listener: EventListener) =>
        listeners.set(name, listener),
      ),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", documentMock);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(first)));
    const client = createClient({ clientKey, context: { key: "user" } });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).not.toHaveBeenCalled();
    documentMock.visibilityState = "visible";
    listeners.get("visibilitychange")?.(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    await client.ready();

    expect(fetch).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("evaluates exactly once when a version probe reports newer configuration", async () => {
    const second: EvalSnapshot = {
      version: 2,
      flags: { checkout: { ...first.flags.checkout!, value: false, variant: "off" } },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(versionResponse(2))
      .mockResolvedValueOnce(jsonResponse(second));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ clientKey, context: { key: "user" }, bootstrap: first });

    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/v1/version",
      "/v1/eval",
    ]);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("X-FlagWire-Reason")).toBe(
      "config",
    );
    expect(client.get("checkout", true)).toBe(false);
    client.close();
  });

  it("keeps interval polling disabled unless explicitly configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(first));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ activation: "manual", clientKey, context: { key: "user" } });

    await client.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("polls versions with jitter only while a visible client is visible", async () => {
    const listeners = new Map<string, EventListener>();
    const documentMock = {
      visibilityState: "visible",
      addEventListener: vi.fn((name: string, listener: EventListener) =>
        listeners.set(name, listener),
      ),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", documentMock);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({
      bootstrap: first,
      clientKey,
      context: { key: "user" },
      pollIntervalMs: 30_000,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("X-FlagWire-Reason")),
    ).toEqual(["activation", "poll"]);

    documentMock.visibilityState = "hidden";
    listeners.get("visibilitychange")?.(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    client.close();
  });

  it("checks a version for refresh and evaluates only for a forced refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(jsonResponse(first));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ clientKey, context: { key: "user" }, bootstrap: first });
    await vi.advanceTimersByTimeAsync(0);

    await client.refresh();
    await client.refresh({ force: true });

    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/v1/version",
      "/v1/version",
      "/v1/eval",
    ]);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-FlagWire-Reason")).toBe(
      "activation",
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("X-FlagWire-Reason")).toBe(
      "manual",
    );
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("X-FlagWire-Reason")).toBe(
      "force",
    );
    client.close();
  });

  it("evaluates one newer stream version and reconnects with jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.stubGlobal("WebSocket", TestSocket);
    const second = { ...first, version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(jsonResponse(second));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({
      bootstrap: first,
      clientKey,
      context: { key: "user" },
      stream: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(TestSocket.instances).toHaveLength(1);
    TestSocket.instances[0]?.message(JSON.stringify({ t: "v", version: 2 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/v1/version",
      "/v1/eval",
    ]);

    TestSocket.instances[0]?.disconnect();
    await vi.advanceTimersByTimeAsync(2_749);
    expect(TestSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(TestSocket.instances).toHaveLength(2);
    client.close();
  });

  it("does not lose a newer stream version during the initial evaluation", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    let resolveInitial: ((response: Response) => void) | undefined;
    const second = { ...first, version: 2 };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveInitial = resolve;
          }),
      )
      .mockResolvedValueOnce(jsonResponse(second));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({
      activation: "manual",
      clientKey,
      context: { key: "user" },
      stream: true,
    });

    const started = client.start();
    TestSocket.instances[0]?.message(JSON.stringify({ t: "v", version: 2 }));
    resolveInitial?.(jsonResponse(first));
    await started;
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.get("checkout", false)).toBe(true);
    client.close();
  });

  it("treats reordered attributes and string-array membership as equivalent context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(first));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({
      activation: "manual",
      clientKey,
      context: { key: "user", attributes: { plan: "pro", groups: ["beta", "staff"] } },
    });
    await client.start();
    await client.setContext({
      key: "user",
      attributes: { groups: ["staff", "beta"], plan: "pro" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("discards a response when the context changes before it resolves", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(
        jsonResponse({
          ...first,
          version: 2,
          flags: { checkout: { ...first.flags.checkout!, value: false, variant: "off" } },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ activation: "manual", clientKey, context: { key: "user-1" } });

    const initial = client.start().catch(() => undefined);
    const latest = client.setContext({ key: "user-2" });
    resolveFirst?.(jsonResponse(first));
    await Promise.all([initial, latest]);

    expect(client.get("checkout", true)).toBe(false);
    client.close();
  });

  it("clears every cache entry for a rejected client key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(first))
      .mockResolvedValueOnce(jsonResponse(first))
      .mockResolvedValueOnce(jsonResponse({ error: true }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ activation: "manual", clientKey, context: { key: "user-1" } });
    await client.start();
    await client.setContext({ key: "user-2" });
    expect(storage.values.size).toBe(2);

    await expect(client.refresh({ force: true })).rejects.toThrow("HTTP 401");

    expect(client.get("checkout", false)).toBe(false);
    expect(storage.values.size).toBe(0);
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
    client.close();
  });

  it("keeps a warm snapshot on quota 429 and honors Retry-After", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "FREE_USAGE_LIMIT_REACHED", resetsAt: "2026-09-01T00:00:00.000Z" } },
          429,
          { "Retry-After": "3600" },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({
      clientKey,
      context: { key: "user" },
      bootstrap: first,
      pollIntervalMs: 30_000,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(client.get("checkout", false)).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(
      fetchMock.mock.calls.filter(([url]) => new URL(url).pathname !== "/v1/events"),
    ).toHaveLength(1);
    client.close();
  });

  it("does not queue exposures when tracking is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({
      clientKey,
      context: { key: "user" },
      bootstrap: first,
      exposureTracking: "disabled",
    });
    await vi.advanceTimersByTimeAsync(0);
    client.get("checkout", false);
    await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("rejects cold readiness when closed before manual activation", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = createClient({ activation: "manual", clientKey, context: { key: "user" } });
    const readiness = client.ready();
    client.close();

    await expect(readiness).rejects.toThrow("client closed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses caller defaults for a cold client while the Free allowance is restricted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "FREE_USAGE_LIMIT_REACHED" } }, 429, {
          "Retry-After": "60",
        }),
      ),
    );
    const client = createClient({ activation: "immediate", clientKey, context: { key: "cold" } });

    await expect(client.ready()).rejects.toThrow("HTTP 429");
    expect(client.get("checkout", false)).toBe(false);
    expect(storage.removeItem).not.toHaveBeenCalled();
    client.close();
  });
});
